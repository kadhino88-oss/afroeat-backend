'use strict';

// Relance par lot des versements en attente + endpoint cron protégé par CRON_SECRET.
// Stripe, Order, User et Restaurant sont des doubles en mémoire (aucun réseau, aucune base).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes } = require('./helpers/paymentHarness');

const h = createPaymentHarness();
const { store, stripe, USER_ID } = h;
const Order = require('../models/Order');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { checkCronSecret } = require('../utils/cronAuth');
const { retryPendingPayouts, clampLimit, MAX_LIMIT } = require('../utils/payoutRetry');
const { retryPayoutsCron } = require('../controllers/connectController');
const { router } = require('../routes/paymentRoutes');

const SECRET = 'cron-secret-for-tests-0123456789';
const oid = (n) => `64b00000000000000000${String(n).padStart(4, '0')}`;

// --- Mini moteur de requête pour Order.find (égalité, $in, $ne, $or ; null == absent comme MongoDB) ---
const matchValue = (value, cond) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('$in' in cond) return cond.$in.some((c) => (c === null ? value === null || value === undefined : value === c));
    if ('$ne' in cond) return cond.$ne === null ? value !== null && value !== undefined : value !== cond.$ne;
    return false;
  }
  if (cond === null) return value === null || value === undefined;
  return value === cond;
};
const matchDoc = (doc, filter) => Object.entries(filter).every(([key, cond]) => (
  key === '$or' ? cond.some((sub) => matchDoc(doc, sub)) : matchValue(doc[key], cond)
));

const findCalls = [];
Order.find = (filter) => {
  findCalls.push(filter);
  const query = { limit: Infinity, sort: null };
  const chain = {
    sort(s) { query.sort = s; return chain; },
    limit(n) { query.limit = n; return chain; },
    select() { return chain; },
    lean() { return chain; },
    then(resolve, reject) {
      try {
        let docs = [...store.values()].filter((d) => matchDoc(d, filter));
        if (query.sort) {
          docs = docs.sort((a, b) => {
            const ta = a.payoutUpdatedAt ? new Date(a.payoutUpdatedAt).getTime() : -Infinity;
            const tb = b.payoutUpdatedAt ? new Date(b.payoutUpdatedAt).getTime() : -Infinity;
            if (ta !== tb) return ta < tb ? -1 : 1;
            return String(a._id) < String(b._id) ? -1 : 1;
          });
        }
        resolve(docs.slice(0, query.limit).map((d) => ({ _id: d._id })));
      } catch (error) { reject(error); }
    },
  };
  return chain;
};

// --- Partenaires Connect prêts à recevoir des transferts ---
Restaurant.findById = (id) => ({ select: async () => ({ owner: `owner_${id}` }) });
User.findById = (id) => ({
  select: async () => ({
    _id: id, countryCode: 'FR', stripeConnectAccountId: `acct_${id}`,
    stripeConnectTransfersEnabled: true, stripeConnectPayoutsEnabled: true,
  }),
});

// --- Stripe : transferts idempotents par clé, comme le vrai service ---
const transferCalls = [];
const transfersByKey = new Map();
stripe.transfers = {
  create: async (params, options) => {
    transferCalls.push({ params, options });
    if (!transfersByKey.has(options.idempotencyKey)) {
      transfersByKey.set(options.idempotencyKey, { id: `tr_${transfersByKey.size + 1}` });
    }
    return transfersByKey.get(options.idempotencyKey);
  },
  createReversal: async () => ({ id: 'trr_1' }),
};
// Un PaymentIntent par commande (pi_<n>), cohérent avec ses métadonnées.
stripe.paymentIntents.retrieve = async (id) => h.paymentIntent({
  id, latest_charge: 'ch_1', metadata: { orderId: oid(Number(id.slice(3))), userId: USER_ID },
});

const addDelivered = (n, extra = {}) => h.addOrder({
  _id: oid(n), status: 'Livrée', paymentStatus: 'Payé', paymentMethod: 'card', payoutStatus: 'pending',
  marketplaceSplitCalculated: true, restaurant: `rest${n}`, deliveryPerson: `cour${n}`,
  restaurantEarning: 7, driverEarning: 2, totalPrice: 10, currency: 'EUR',
  stripePaymentIntentId: `pi_${n}`, user: USER_ID, ...extra,
});

const setEnabled = (on) => {
  if (on) {
    process.env.STRIPE_CONNECT_PAYOUTS_ENABLED = 'true';
    process.env.STRIPE_PLATFORM_COUNTRY = 'FR';
    process.env.STRIPE_CONNECT_COUNTRIES = 'FR';
  } else {
    delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED;
  }
};

test.beforeEach((t) => {
  store.clear(); findCalls.length = 0; transferCalls.length = 0; transfersByKey.clear();
  setEnabled(true);
  process.env.CRON_SECRET = SECRET;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
});
test.after(() => { setEnabled(false); delete process.env.CRON_SECRET; });

const reqWith = (authorization, query = {}) => ({ headers: authorization === undefined ? {} : { authorization }, query });
const call = async (authorization, query) => {
  const res = createRes();
  await retryPayoutsCron(reqWith(authorization, query), res);
  return res;
};

test('checkCronSecret : absent -> 403, incorrect/manquant -> 401, correct -> ok', () => {
  assert.deepEqual(checkCronSecret(reqWith(`Bearer ${SECRET}`), {}), { ok: false, status: 403, code: 'CRON_DISABLED' });
  assert.equal(checkCronSecret(reqWith('Bearer '), { CRON_SECRET: '' }).status, 403);
  const env = { CRON_SECRET: SECRET };
  assert.equal(checkCronSecret(reqWith(undefined), env).status, 401);
  assert.equal(checkCronSecret(reqWith('Bearer nope'), env).status, 401);
  assert.equal(checkCronSecret(reqWith(`Bearer ${SECRET}x`), env).status, 401);
  assert.equal(checkCronSecret(reqWith(`Bearer ${SECRET.slice(1)}`), env).status, 401);
  assert.equal(checkCronSecret(reqWith(`Basic ${SECRET}`), env).status, 401);
  assert.equal(checkCronSecret(reqWith(SECRET), env).status, 401);
  assert.equal(checkCronSecret(reqWith('Bearer'), env).status, 401);
  assert.deepEqual(checkCronSecret(reqWith(`Bearer ${SECRET}`), env), { ok: true });
});

test('endpoint : secret non configuré -> 403, secret incorrect -> 401, aucun accès aux commandes', async () => {
  addDelivered(1);
  delete process.env.CRON_SECRET;
  let res = await call(`Bearer ${SECRET}`);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);

  process.env.CRON_SECRET = SECRET;
  res = await call('Bearer wrong-secret');
  assert.equal(res.statusCode, 401);
  res = await call(undefined);
  assert.equal(res.statusCode, 401);
  assert.equal(findCalls.length, 0);
  assert.equal(transferCalls.length, 0);
});

test('route POST /connect/retry-payouts : montée, sans session utilisateur, un seul gestionnaire', () => {
  const layer = router.stack.find((l) => l.route?.path === '/connect/retry-payouts');
  assert.ok(layer, 'route absente');
  assert.equal(layer.route.methods.post, true);
  assert.equal(layer.route.stack.length, 1);
});

test('endpoint : relance les versements et ne renvoie que des compteurs', async () => {
  addDelivered(1);
  addDelivered(2, { payoutStatus: 'reconciliation_required', payoutError: 'ancien échec' });
  const res = await call(`Bearer ${SECRET}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, retried: 2, succeeded: 2, failed: 0 });
  assert.equal(store.get(oid(1)).payoutStatus, 'transferred');
  assert.equal(store.get(oid(2)).payoutStatus, 'transferred');
  assert.equal(transferCalls.length, 4);
});

test('lot borné : au plus `limit` commandes, jamais tentées puis tentative la plus ancienne d\'abord', async () => {
  const day = (d) => new Date(Date.UTC(2026, 0, d));
  addDelivered(1, { payoutUpdatedAt: day(5) });
  addDelivered(2, { payoutUpdatedAt: day(2), payoutStatus: 'reconciliation_required' });
  addDelivered(3);
  addDelivered(4, { payoutUpdatedAt: day(9) });
  addDelivered(5, { payoutUpdatedAt: day(1) });
  const seen = [];
  const result = await retryPendingPayouts({ limit: 3, reconcile: async (id) => { seen.push(String(id)); return { success: true }; } });
  assert.deepEqual(seen, [oid(3), oid(5), oid(2)]);
  assert.deepEqual(result, { retried: 3, succeeded: 3, failed: 0 });
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit('abc'), 20);
  assert.equal(clampLimit('0'), 20);
  assert.equal(clampLimit('100000'), MAX_LIMIT);
  assert.equal(clampLimit('7'), 7);
});

test('litige ouvert, commande non livrée, déjà versée ou sans répartition vérifiée : ignorées', async () => {
  addDelivered(1, { stripeDisputeId: 'dp_open', stripeDisputeClosedAt: null });
  addDelivered(2, { status: 'En préparation' });
  addDelivered(3, { payoutStatus: 'transferred' });
  addDelivered(4, { marketplaceSplitCalculated: false });
  addDelivered(5, { payoutStatus: 'manually_reconciled' });
  addDelivered(6, { stripeDisputeId: 'dp_closed', stripeDisputeClosedAt: new Date() }); // litige clos : éligible
  addDelivered(7, { stripeDisputeId: '' });
  const seen = [];
  const result = await retryPendingPayouts({ reconcile: async (id) => { seen.push(String(id)); return { success: true }; } });
  assert.deepEqual(seen.sort(), [oid(6), oid(7)]);
  assert.equal(result.retried, 2);
  assert.equal(transferCalls.length, 0);
});

test('Connect désactivé : rien n\'est relancé, aucune requête', async () => {
  setEnabled(false);
  addDelivered(1);
  const result = await retryPendingPayouts();
  assert.deepEqual(result, { retried: 0, succeeded: 0, failed: 0, skipped: 'connect_disabled' });
  assert.equal(findCalls.length, 0);
  assert.equal(transferCalls.length, 0);
});

test('échecs comptés sans exception ; budget de temps respecté', async () => {
  addDelivered(1); addDelivered(2); addDelivered(3);
  const outcomes = [{ success: true }, { success: false }, 'throw'];
  let i = 0;
  const result = await retryPendingPayouts({
    reconcile: async () => { const o = outcomes[i++]; if (o === 'throw') throw new Error('boom'); return o; },
  });
  assert.deepEqual(result, { retried: 3, succeeded: 1, failed: 2 });

  let clock = 0;
  const seen = [];
  const limited = await retryPendingPayouts({
    budgetMs: 10, now: () => clock,
    reconcile: async (id) => { seen.push(id); clock += 100; return { success: true }; },
  });
  assert.equal(limited.retried, 1);
  assert.equal(seen.length, 1);
});

test('double exécution (séquentielle puis simultanée) : aucun transfert en double', async () => {
  addDelivered(1);
  addDelivered(2);
  const first = await retryPendingPayouts();
  assert.deepEqual(first, { retried: 2, succeeded: 2, failed: 0 });
  assert.equal(transfersByKey.size, 4);

  const second = await retryPendingPayouts();
  assert.deepEqual(second, { retried: 0, succeeded: 0, failed: 0 });
  assert.equal(transferCalls.length, 4);

  // Deux exécutions simultanées sur de nouvelles commandes : les clés d'idempotence Stripe dédupliquent.
  addDelivered(3);
  addDelivered(4);
  await Promise.all([retryPendingPayouts(), retryPendingPayouts()]);
  assert.equal(transfersByKey.size, 8);
  for (const [key] of transfersByKey) assert.match(key, /^afroeat_(restaurant|courier)_transfer_64b/);
  assert.equal(store.get(oid(3)).payoutStatus, 'transferred');
  assert.equal(store.get(oid(4)).payoutStatus, 'transferred');
});

test('une commande dont le compte partenaire n\'est pas prêt reste à rapprocher et est comptée en échec', async () => {
  addDelivered(1);
  const original = User.findById;
  User.findById = () => ({ select: async () => ({ _id: 'x', countryCode: 'FR', stripeConnectAccountId: 'acct_x', stripeConnectTransfersEnabled: false, stripeConnectPayoutsEnabled: false }) });
  try {
    const result = await retryPendingPayouts();
    assert.deepEqual(result, { retried: 1, succeeded: 0, failed: 1 });
  } finally { User.findById = original; }
  assert.equal(store.get(oid(1)).payoutStatus, 'reconciliation_required');
  assert.equal(transferCalls.length, 0);
});
