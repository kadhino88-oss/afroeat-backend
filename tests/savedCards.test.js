'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSavedCardController, toPublicCard, safeStripeMessage } = require('../controllers/savedCardController');

const USER_ID = '650000000000000000000001';

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const makeUserModel = (initial = {}) => {
  const state = { stripeCustomerId: initial.stripeCustomerId || null, raceWinner: initial.raceWinner || null };
  return {
    state,
    findById: () => ({
      select: async () => ({ _id: USER_ID, email: 'a@b.ch', name: 'Awa', stripeCustomerId: state.stripeCustomerId }),
    }),
    findOneAndUpdate: async (_filter, update) => {
      if (state.raceWinner) { state.stripeCustomerId = state.raceWinner; return null; }
      state.stripeCustomerId = update.stripeCustomerId;
      return { _id: USER_ID, stripeCustomerId: update.stripeCustomerId };
    },
  };
};

const card = (id, extra = {}) => ({
  id,
  type: 'card',
  customer: 'cus_mine',
  card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030, fingerprint: 'SECRET_FP' },
  ...extra,
});

const makeStripe = (overrides = {}) => {
  const calls = [];
  const stripe = {
    calls,
    customers: {
      create: async (args) => { calls.push(['customers.create', args]); return { id: 'cus_new' }; },
      del: async (id) => { calls.push(['customers.del', id]); return {}; },
      retrieve: async () => ({ id: 'cus_mine', invoice_settings: { default_payment_method: 'pm_default1' } }),
      update: async (id, args) => { calls.push(['customers.update', id, args]); return {}; },
    },
    paymentMethods: {
      list: async () => ({ data: [card('pm_default1'), card('pm_other001')] }),
      retrieve: async (id) => {
        if (id === 'pm_missing01') { const e = new Error('No such'); e.code = 'resource_missing'; throw e; }
        if (id === 'pm_foreign01') return card(id, { customer: 'cus_someone_else' });
        if (id === 'pm_notcard01') return card(id, { type: 'sepa_debit' });
        return card(id);
      },
      detach: async (id) => { calls.push(['paymentMethods.detach', id]); return {}; },
    },
    setupIntents: {
      create: async (args) => { calls.push(['setupIntents.create', args]); return { id: 'seti_1', client_secret: 'seti_1_secret_x' }; },
    },
    checkout: {
      sessions: {
        create: async (args) => { calls.push(['checkout.sessions.create', args]); return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }; },
      },
    },
    ...overrides,
  };
  return stripe;
};

const run = async (controller, name, { params = {}, body = {} } = {}) => {
  const res = makeRes();
  await controller[name]({ user: { _id: USER_ID }, params, body }, res);
  return res;
};

test('sans clé Stripe : 503 sur toutes les routes de cartes', async () => {
  const controller = createSavedCardController({ stripe: null, User: makeUserModel() });
  for (const name of ['listSavedCards', 'createCardSetupIntent', 'setDefaultSavedCard', 'removeSavedCard']) {
    const res = await run(controller, name, { params: { paymentMethodId: 'pm_other001' }, body: { consentAccepted: true } });
    assert.equal(res.statusCode, 503, name);
    assert.equal(res.body.code, 'STRIPE_NOT_CONFIGURED');
  }
});

test('liste : client sans compte Stripe → liste vide, sans appel Stripe', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({ stripe, User: makeUserModel() });
  const res = await run(controller, 'listSavedCards');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, cards: [], defaultPaymentMethod: null });
  assert.equal(stripe.calls.length, 0);
});

test('liste : format public, carte par défaut marquée, aucune donnée sensible', async () => {
  const controller = createSavedCardController({
    stripe: makeStripe(),
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  const res = await run(controller, 'listSavedCards');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.defaultPaymentMethod, 'pm_default1');
  assert.deepEqual(res.body.cards[0], {
    id: 'pm_default1', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030, isDefault: true,
  });
  assert.equal(res.body.cards[1].isDefault, false);
  assert.doesNotMatch(JSON.stringify(res.body), /SECRET_FP|fingerprint/);
});

test('setup-intent : exige le consentement explicite', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({ stripe, User: makeUserModel() });
  for (const body of [{}, { consentAccepted: 'true' }, { consentAccepted: false }]) {
    const res = await run(controller, 'createCardSetupIntent', { body });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'CARD_CONSENT_REQUIRED');
  }
  assert.equal(stripe.calls.length, 0);
});

test('setup-intent : crée le client Stripe puis un SetupIntent hors-session', async () => {
  const stripe = makeStripe();
  const users = makeUserModel();
  process.env.STRIPE_PLATFORM_COUNTRY = 'ch';
  const controller = createSavedCardController({ stripe, User: users });
  const res = await run(controller, 'createCardSetupIntent', { body: { consentAccepted: true } });
  delete process.env.STRIPE_PLATFORM_COUNTRY;

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.clientSecret, 'seti_1_secret_x');
  assert.equal(res.body.merchantCountryCode, 'CH');
  assert.equal(users.state.stripeCustomerId, 'cus_new');
  const intent = stripe.calls.find(([name]) => name === 'setupIntents.create')[1];
  assert.equal(intent.customer, 'cus_new');
  assert.equal(intent.usage, 'off_session');
  assert.deepEqual(intent.payment_method_types, ['card']);
});

test('setup-intent : réutilise le client existant (aucune création)', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({
    stripe,
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  const res = await run(controller, 'createCardSetupIntent', { body: { consentAccepted: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(stripe.calls.some(([name]) => name === 'customers.create'), false);
});

test('setup-intent : course entre deux requêtes → un seul client conservé, doublon supprimé', async () => {
  const stripe = makeStripe();
  const users = makeUserModel({ raceWinner: 'cus_winner' });
  const controller = createSavedCardController({ stripe, User: users });
  const res = await run(controller, 'createCardSetupIntent', { body: { consentAccepted: true } });
  assert.equal(res.statusCode, 200);
  assert.ok(stripe.calls.some(([name, id]) => name === 'customers.del' && id === 'cus_new'));
  assert.equal(stripe.calls.find(([name]) => name === 'setupIntents.create')[1].customer, 'cus_winner');
});

test('carte par défaut : identifiant invalide → 400, carte d\'un autre client / inexistante / non-carte → 404', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({
    stripe,
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  assert.equal((await run(controller, 'setDefaultSavedCard', { params: { paymentMethodId: '../etc' } })).statusCode, 400);
  for (const id of ['pm_foreign01', 'pm_missing01', 'pm_notcard01']) {
    const res = await run(controller, 'setDefaultSavedCard', { params: { paymentMethodId: id } });
    assert.equal(res.statusCode, 404, id);
  }
  assert.equal(stripe.calls.some(([name]) => name === 'customers.update'), false);
});

test('carte par défaut : met à jour uniquement une carte du client', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({
    stripe,
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  const res = await run(controller, 'setDefaultSavedCard', { params: { paymentMethodId: 'pm_other001' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(stripe.calls.find(([name]) => name === 'customers.update').slice(1), [
    'cus_mine',
    { invoice_settings: { default_payment_method: 'pm_other001' } },
  ]);
});

test('suppression : refuse la carte d\'un autre client, détache la sienne', async () => {
  const stripe = makeStripe();
  const controller = createSavedCardController({
    stripe,
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  const foreign = await run(controller, 'removeSavedCard', { params: { paymentMethodId: 'pm_foreign01' } });
  assert.equal(foreign.statusCode, 404);
  assert.equal(stripe.calls.some(([name]) => name === 'paymentMethods.detach'), false);

  const own = await run(controller, 'removeSavedCard', { params: { paymentMethodId: 'pm_other001' } });
  assert.equal(own.statusCode, 200);
  assert.deepEqual(stripe.calls.find(([name]) => name === 'paymentMethods.detach'), ['paymentMethods.detach', 'pm_other001']);
});

test('suppression / défaut : client sans compte Stripe → 404', async () => {
  const controller = createSavedCardController({ stripe: makeStripe(), User: makeUserModel() });
  for (const name of ['removeSavedCard', 'setDefaultSavedCard']) {
    const res = await run(controller, name, { params: { paymentMethodId: 'pm_other001' } });
    assert.equal(res.statusCode, 404, name);
  }
});

test('erreur Stripe : réponse 502 générique, sans fuite de détails', async () => {
  const stripe = makeStripe({
    paymentMethods: { list: async () => { const e = new Error('detail interne cle sk_test_xxx'); e.type = 'StripeAPIError'; throw e; } },
  });
  const controller = createSavedCardController({
    stripe,
    User: makeUserModel({ stripeCustomerId: 'cus_mine' }),
  });
  const originalError = console.error;
  console.error = () => {};
  const res = await run(controller, 'listSavedCards');
  console.error = originalError;
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /sk_test|detail interne/);
});

const withEnv = async (env, fn) => {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test('setup-session web : 503 sans Stripe, 400 sans consentement', async () => {
  const none = createSavedCardController({ stripe: null, User: makeUserModel() });
  assert.equal((await run(none, 'createCardSetupSession', { body: { consentAccepted: true } })).statusCode, 503);
  const stripe = makeStripe();
  const controller = createSavedCardController({ stripe, User: makeUserModel() });
  const res = await run(controller, 'createCardSetupSession', { body: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'CARD_CONSENT_REQUIRED');
  assert.equal(stripe.calls.length, 0);
});

test('setup-session web : crée une session Checkout en mode setup pour le client', async () => {
  await withEnv({ PUBLIC_WEB_URL: 'https://afroeat.app', CORS_ORIGINS: '', CORS_EXTRA_ORIGINS: '' }, async () => {
    const stripe = makeStripe();
    const controller = createSavedCardController({ stripe, User: makeUserModel({ stripeCustomerId: 'cus_mine' }) });
    const res = await run(controller, 'createCardSetupSession', { body: { consentAccepted: true } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_1');
    const args = stripe.calls.find(([n]) => n === 'checkout.sessions.create')[1];
    assert.equal(args.mode, 'setup');
    assert.equal(args.customer, 'cus_mine');
    // Stripe refuse payment_method_types pour Checkout : il ne doit pas être envoyé.
    assert.equal('payment_method_types' in args, false);
    assert.equal(args.success_url, 'https://afroeat.app/profile/payment?cardSetup=success');
    assert.equal(args.cancel_url, 'https://afroeat.app/profile/payment?cardSetup=cancel');
  });
});

test('setup-session web : origine de retour autorisée acceptée, étrangère ignorée (anti open-redirect)', async () => {
  await withEnv({ PUBLIC_WEB_URL: 'https://afroeat.app', CORS_ORIGINS: 'https://afroeat-app.vercel.app', CORS_EXTRA_ORIGINS: '' }, async () => {
    const ok = makeStripe();
    await run(createSavedCardController({ stripe: ok, User: makeUserModel({ stripeCustomerId: 'cus_mine' }) }),
      'createCardSetupSession', { body: { consentAccepted: true, returnUrl: 'https://afroeat-app.vercel.app/x' } });
    assert.match(ok.calls.find(([n]) => n === 'checkout.sessions.create')[1].success_url, /^https:\/\/afroeat-app\.vercel\.app\//);

    const evil = makeStripe();
    await run(createSavedCardController({ stripe: evil, User: makeUserModel({ stripeCustomerId: 'cus_mine' }) }),
      'createCardSetupSession', { body: { consentAccepted: true, returnUrl: 'https://evil.example/steal' } });
    assert.match(evil.calls.find(([n]) => n === 'checkout.sessions.create')[1].success_url, /^https:\/\/afroeat\.app\//);
  });
});

test('setup-session web : aucune origine configurée → 400', async () => {
  await withEnv({ PUBLIC_WEB_URL: '', CORS_ORIGINS: '', CORS_EXTRA_ORIGINS: '' }, async () => {
    const controller = createSavedCardController({ stripe: makeStripe(), User: makeUserModel() });
    const res = await run(controller, 'createCardSetupSession', { body: { consentAccepted: true } });
    assert.equal(res.statusCode, 400);
  });
});

test('toPublicCard : valeurs par défaut sûres', () => {
  assert.deepEqual(toPublicCard({ id: 'pm_x0000001' }, null), {
    id: 'pm_x0000001', brand: 'card', last4: '', expMonth: null, expYear: null, isDefault: false,
  });
});

test('journal : le message Stripe est conservé mais toute clé est masquée', () => {
  assert.equal(
    safeStripeMessage({ raw: { message: 'Invalid URL: x. Key sk_test_ABC123def used' } }),
    'Invalid URL: x. Key sk_test_*** used'
  );
  assert.equal(safeStripeMessage(null), '');
});
