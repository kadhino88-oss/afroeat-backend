'use strict';

// Webhook Stripe « Connect » (POST /api/payments/webhook/connect) : secret de signature distinct,
// corps brut monté avant express.json, déduplication par event.id. Stripe, StripeEvent et User sont
// des doubles en mémoire (aucun réseau, aucune base).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness } = require('./helpers/paymentHarness');

const h = createPaymentHarness();
const { events, stripe, calls } = h;
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:1/afroeat_unit';

const app = require('../server');
const User = require('../models/User');

// La signature est vérifiée avec le secret transmis : le double refuse tout autre secret.
const CONNECT_SECRET = 'whsec_connect_test';
const usedSecrets = [];
stripe.webhooks.constructEvent = (body, signature, secret) => {
  calls.constructEvent += 1;
  usedSecrets.push(secret);
  if (signature !== 'valid' || secret !== CONNECT_SECRET) throw new Error('No signatures found matching the expected signature');
  assert.ok(Buffer.isBuffer(body), 'le corps doit rester brut (monté avant express.json)');
  return JSON.parse(body.toString('utf8'));
};

const userUpdates = [];
let failUserUpdate = false;
User.findOneAndUpdate = async (filter, update) => {
  if (failUserUpdate) throw new Error('db down');
  userUpdates.push({ filter, update });
  return {};
};

test.beforeEach((t) => {
  events.clear(); userUpdates.length = 0; usedSecrets.length = 0; failUserUpdate = false; calls.constructEvent = 0;
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = CONNECT_SECRET;
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
});
test.after(() => { delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET; });

const withServer = async (fn) => {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}/api/payments/webhook/connect`); } finally { server.close(); }
};
const post = (url, event, signature = 'valid') => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
  body: JSON.stringify(event),
});
const accountUpdated = (id = 'evt_acct_1') => ({
  id, type: 'account.updated', account: 'acct_42',
  data: { object: { id: 'acct_42', details_submitted: true, payouts_enabled: true, country: 'fr', capabilities: { transfers: 'active' }, requirements: { currently_due: ['x', 'y'] } } },
});

test('secret Connect absent : 400 sans crash et sans vérification de signature', async () => {
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  await withServer(async (url) => {
    const response = await post(url, accountUpdated());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
  });
  assert.equal(calls.constructEvent, 0);
  assert.equal(userUpdates.length, 0);
});

test('signature absente ou invalide : 400, aucun effet', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, accountUpdated(), null)).status, 400);
    const bad = await post(url, accountUpdated(), 'forged');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'INVALID_WEBHOOK_SIGNATURE');
  });
  assert.equal(userUpdates.length, 0);
  assert.equal(events.size, 0);
});

test('le secret de la plateforme n\'est jamais utilisé pour ce endpoint', async () => {
  await withServer(async (url) => { await post(url, accountUpdated()); });
  assert.deepEqual(usedSecrets, [CONNECT_SECRET]);
  assert.notEqual(usedSecrets[0], process.env.STRIPE_WEBHOOK_SECRET);
});

test('account.updated : statut Connect du partenaire mis à jour', async () => {
  await withServer(async (url) => {
    const response = await post(url, accountUpdated());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  });
  assert.equal(userUpdates.length, 1);
  assert.deepEqual(userUpdates[0].filter, { stripeConnectAccountId: 'acct_42' });
  assert.deepEqual(userUpdates[0].update.$set, {
    stripeConnectDetailsSubmitted: true,
    stripeConnectTransfersEnabled: true,
    stripeConnectPayoutsEnabled: true,
    stripeConnectRequirementsDueCount: 2,
    countryCode: 'FR',
  });
  assert.equal(events.get('evt_acct_1').status, 'done');
});

test('événement rejoué (même event.id) : acquitté, traité une seule fois', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, accountUpdated('evt_acct_2'))).status, 200);
    const again = await post(url, accountUpdated('evt_acct_2'));
    assert.equal(again.status, 200);
    assert.equal((await again.json()).duplicate, true);
  });
  assert.equal(userUpdates.length, 1);
});

test('échec de traitement : 500 et enregistrement libéré pour que Stripe rejoue', async () => {
  failUserUpdate = true;
  await withServer(async (url) => {
    const first = await post(url, accountUpdated('evt_acct_3'));
    assert.equal(first.status, 500);
    assert.equal(events.has('evt_acct_3'), false);
    failUserUpdate = false;
    assert.equal((await post(url, accountUpdated('evt_acct_3'))).status, 200);
  });
  assert.equal(userUpdates.length, 1);
});

test('autres événements Connect : acquittés sans effet', async () => {
  await withServer(async (url) => {
    const response = await post(url, { id: 'evt_other', type: 'capability.updated', data: { object: {} } });
    assert.equal(response.status, 200);
  });
  assert.equal(userUpdates.length, 0);
  assert.equal(events.get('evt_other').status, 'done');
});
