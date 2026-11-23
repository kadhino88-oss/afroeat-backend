'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes, createReq } = require('./helpers/paymentHarness');

const h = createPaymentHarness();
const { controller, store, events, announced, PI_ID } = h;

test.beforeEach(() => { store.clear(); events.clear(); announced.length = 0; });

const send = async (event) => { const res = createRes(); await controller.handleWebhook(createReq(event), res); return res; };

test('payment_intent.canceled : commande non payée marquée « Non payé » avec le motif', async () => {
  h.addOrder({ paymentStatus: 'Non payé' });
  const res = await send({ id: 'evt_c1', type: 'payment_intent.canceled', data: { object: h.paymentIntent({ status: 'canceled', cancellation_reason: 'abandoned' }) } });
  assert.equal(res.statusCode, 200);
  assert.match(store.get(h.ORDER_ID).lastPaymentError, /annulé.*abandoned/);
});

test('payment_intent.canceled : une commande déjà payée n\'est jamais rétrogradée', async () => {
  h.addOrder({ paymentStatus: 'Payé' });
  await send({ id: 'evt_c2', type: 'payment_intent.canceled', data: { object: h.paymentIntent({ status: 'canceled' }) } });
  assert.equal(store.get(h.ORDER_ID).paymentStatus, 'Payé');
  assert.equal(store.get(h.ORDER_ID).lastPaymentError, undefined);
});

test('refund.failed : l\'échec est conservé pour réconciliation, la commande n\'est pas « Remboursé »', async () => {
  h.addOrder({ paymentStatus: 'Payé', status: 'Annulée', refundRequestedAt: new Date() });
  const res = await send({ id: 'evt_r1', type: 'refund.failed', data: { object: { id: 're_9', status: 'failed', failure_reason: 'expired_or_canceled_card', payment_intent: PI_ID } } });
  assert.equal(res.statusCode, 200);
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.paymentStatus, 'Payé');
  assert.match(saved.refundError, /expired_or_canceled_card/);
  assert.equal(saved.stripeRefundId, 're_9');
});

test('refund.updated « succeeded » applique le remboursement ; « failed » après remboursement ne le défait pas', async () => {
  h.addOrder({ paymentStatus: 'Payé', status: 'Annulée' });
  await send({ id: 'evt_r2', type: 'refund.updated', data: { object: { id: 're_1', status: 'succeeded', amount: 1000, payment_intent: PI_ID } } });
  assert.equal(store.get(h.ORDER_ID).paymentStatus, 'Remboursé');
  await send({ id: 'evt_r3', type: 'refund.updated', data: { object: { id: 're_1', status: 'failed', payment_intent: PI_ID } } });
  const saved = store.get(h.ORDER_ID);
  assert.equal(saved.paymentStatus, 'Remboursé');
  assert.equal(saved.refundError, undefined);
});

test('charge.dispute.updated : litige ouvert signalé ; litige déjà clos non rouvert', async () => {
  h.addOrder({ paymentStatus: 'Payé' });
  await send({ id: 'evt_d1', type: 'charge.dispute.updated', data: { object: { id: 'dp_1', status: 'under_review', payment_intent: PI_ID } } });
  let saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'reconciliation_required');
  assert.equal(saved.stripeDisputeId, 'dp_1');

  store.get(h.ORDER_ID).payoutStatus = 'pending';
  store.get(h.ORDER_ID).stripeDisputeId = null;
  await send({ id: 'evt_d2', type: 'charge.dispute.updated', data: { object: { id: 'dp_1', status: 'won', payment_intent: PI_ID } } });
  saved = store.get(h.ORDER_ID);
  assert.equal(saved.payoutStatus, 'pending');
  assert.equal(saved.stripeDisputeId, null);
});
