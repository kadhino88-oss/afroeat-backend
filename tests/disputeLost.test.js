'use strict';

// Litige Stripe perdu : réversion des transferts Connect (ou annulation du versement), sans exception
// vers Stripe en cas d'échec. Stripe et le modèle Order sont des doubles en mémoire (aucun réseau).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes, createReq } = require('./helpers/paymentHarness');

const h = createPaymentHarness();
const { controller, store, events, stripe, PI_ID } = h;
const { createDeliveredOrderTransfers } = require('../utils/marketplacePayouts');

const reversals = [];
const transfersCreated = [];
let failReversalFor = null;

stripe.transfers = {
  create: async (params, options) => { transfersCreated.push({ params, options }); return { id: 'tr_new' }; },
  createReversal: async (transferId, params, options) => {
    reversals.push({ transferId, params, options });
    if (failReversalFor === transferId) {
      const error = new Error('Insufficient funds in your Stripe account');
      error.code = 'balance_insufficient';
      throw error;
    }
    return { id: `trr_${transferId}` };
  },
};

const setConnect = (enabled) => {
  if (enabled) process.env.STRIPE_CONNECT_PAYOUTS_ENABLED = 'true';
  else delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED;
};

test.beforeEach((t) => {
  store.clear(); events.clear(); reversals.length = 0; transfersCreated.length = 0; failReversalFor = null;
  setConnect(true);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
});
test.after(() => setConnect(false));

const send = async (event) => {
  const res = createRes();
  await controller.handleWebhook(createReq(event), res);
  return res;
};
const closed = (id, status = 'lost') => ({
  id, type: 'charge.dispute.closed', data: { object: { id: 'dp_1', status, payment_intent: PI_ID } },
});
const withTransfers = (extra = {}) => h.addOrder({
  paymentStatus: 'Payé', status: 'Livrée', payoutStatus: 'transferred', stripeDisputeId: 'dp_1', marketplaceSplitCalculated: true,
  stripeRestaurantTransferId: 'tr_rest', stripeCourierTransferId: 'tr_cour', ...extra,
});

test('litige perdu sans transfert : versement annulé, aucun appel Stripe', async () => {
  h.addOrder({ paymentStatus: 'Payé', payoutStatus: 'reconciliation_required', stripeDisputeId: 'dp_1' });
  const res = await send(closed('evt_l1'));
  assert.equal(res.statusCode, 200);
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reversed');
  assert.match(saved.payoutError, /aucun transfert/);
  assert.ok(saved.stripeDisputeLostAt);
  assert.ok(saved.stripeDisputeClosedAt);
  assert.equal(reversals.length, 0);
});

test('litige perdu sans transfert, Connect désactivé : même résultat, aucun appel Stripe', async () => {
  setConnect(false);
  h.addOrder({ paymentStatus: 'Payé', payoutStatus: 'pending' });
  await send(closed('evt_l2'));
  assert.equal(store.get(h.ORDER_ID).payoutStatus, 'reversed');
  assert.equal(reversals.length, 0);
});

test('litige perdu avec transferts : réversion de chaque transfert, clés d\'idempotence stables', async () => {
  withTransfers();
  const res = await send(closed('evt_l3'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(reversals.map((r) => r.transferId), ['tr_rest', 'tr_cour']);
  assert.deepEqual(reversals.map((r) => r.options.idempotencyKey), [
    `afroeat_restaurant_reversal_${h.ORDER_ID}`, `afroeat_courier_reversal_${h.ORDER_ID}`,
  ]);
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reversed');
  assert.equal(saved.payoutError, '');
  assert.equal(saved.stripeRestaurantReversalId, 'trr_tr_rest');
  assert.equal(saved.stripeCourierReversalId, 'trr_tr_cour');
});

test('litige perdu avec transferts mais Connect désactivé : traitement admin, aucun appel Stripe', async () => {
  setConnect(false);
  withTransfers();
  const res = await send(closed('evt_l4'));
  assert.equal(res.statusCode, 200);
  assert.equal(reversals.length, 0);
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reconciliation_required');
  assert.match(saved.payoutError, /réverser manuellement/);
});

test('réversion en échec : pas d\'exception, reconciliation_required avec motif, reprise sans double réversion', async () => {
  withTransfers();
  failReversalFor = 'tr_cour';
  const res = await send(closed('evt_l5'));
  assert.equal(res.statusCode, 200);
  let saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reconciliation_required');
  assert.match(saved.payoutError, /balance_insufficient/);
  assert.match(saved.payoutError, /admin/);
  assert.equal(saved.stripeRestaurantReversalId, 'trr_tr_rest');
  assert.equal(saved.stripeCourierReversalId, undefined);
  assert.ok(saved.stripeDisputeLostAt);

  // Reprise (ex. relance) : seul le transfert restant est réversé.
  failReversalFor = null;
  reversals.length = 0;
  const order = h.wrap(saved);
  const result = await createDeliveredOrderTransfers(order._id);
  assert.equal(result.success, true);
  assert.deepEqual(reversals.map((r) => r.transferId), ['tr_cour']);
  assert.equal(transfersCreated.length, 0);
  assert.equal(store.get(h.ORDER_ID).payoutStatus, 'reversed');
});

test('rejeu du même événement : acquitté sans nouvelle réversion', async () => {
  withTransfers();
  await send(closed('evt_l6'));
  assert.equal(reversals.length, 2);
  const again = await send(closed('evt_l6'));
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(reversals.length, 2);
});

test('même litige rejoué sous un autre event.id : état déjà réversé, aucun nouvel appel Stripe', async () => {
  withTransfers();
  await send(closed('evt_l7a'));
  await send(closed('evt_l7b'));
  assert.equal(reversals.length, 2);
  assert.equal(store.get(h.ORDER_ID).payoutStatus, 'reversed');
});

test('commande à litige perdu : jamais de nouveau transfert lors d\'une relance du versement', async () => {
  h.addOrder({
    paymentStatus: 'Payé', status: 'Livrée', payoutStatus: 'reconciliation_required', marketplaceSplitCalculated: true,
    stripeDisputeId: 'dp_1', stripeDisputeClosedAt: new Date(), stripeDisputeLostAt: new Date(),
  });
  const result = await createDeliveredOrderTransfers(h.ORDER_ID);
  assert.equal(result.success, true);
  assert.equal(transfersCreated.length, 0);
  assert.equal(store.get(h.ORDER_ID).payoutStatus, 'reversed');
});

test('versement en cours au moment du litige perdu : rapprochement manuel, aucun appel Stripe', async () => {
  h.addOrder({ paymentStatus: 'Payé', payoutStatus: 'processing' });
  await send(closed('evt_l9'));
  assert.equal(store.get(h.ORDER_ID).payoutStatus, 'reconciliation_required');
  assert.equal(reversals.length, 0);
});

test('litige clos autrement que perdu/gagné : reste à examiner, pas de réversion', async () => {
  withTransfers();
  await send(closed('evt_l10', 'warning_closed'));
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reconciliation_required');
  assert.equal(saved.stripeDisputeLostAt, undefined);
  assert.equal(reversals.length, 0);
});
