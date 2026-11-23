'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness } = require('./helpers/paymentHarness');

const h = createPaymentHarness();
const { controller, store, calls, announced, ORDER_ID } = h;

test.beforeEach(() => { store.clear(); announced.length = 0; calls.refundsCreate.length = 0; });

test('markOrderAsPaid : une seule annonce même avec webhook et /confirm simultanés', async () => {
  h.addOrder();
  const results = await Promise.all([
    controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() }),
    controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() }),
    controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() }),
  ]);
  assert.ok(results.every(Boolean), 'toutes les exécutions répondent de façon idempotente');
  assert.equal(announced.length, 1);
  const saved = store.get(ORDER_ID);
  assert.equal(saved.paymentStatus, 'Payé');
  assert.equal(saved.status, 'Confirmée');
  assert.equal(saved.statusHistory.filter((e) => e.status === 'Confirmée').length, 1);
  assert.ok(saved.paidAt instanceof Date);
});

test('markOrderAsPaid : une commande déjà payée n\'est pas ré-annoncée', async () => {
  h.addOrder({ paymentStatus: 'Payé', status: 'Confirmée' });
  const order = await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() });
  assert.equal(order.paymentStatus, 'Payé');
  assert.equal(announced.length, 0);
});

test('paiement reçu après annulation : pas de « Confirmée », remboursement automatique idempotent', async () => {
  h.addOrder({ status: 'Annulée' });
  const order = await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() });
  assert.ok(order);
  const saved = store.get(ORDER_ID);
  assert.equal(saved.status, 'Annulée');
  assert.equal(announced.length, 0);
  assert.equal(calls.refundsCreate.length, 1);
  assert.equal(calls.refundsCreate[0].params.payment_intent, h.PI_ID);
  assert.equal(calls.refundsCreate[0].options.idempotencyKey, `refund_order_${ORDER_ID}`);
  assert.equal(saved.paymentStatus, 'Remboursé');

  // Rejeu (webhook + /confirm) : aucun second remboursement ni annonce.
  await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() });
  assert.equal(calls.refundsCreate.length, 1);
  assert.equal(announced.length, 0);
});

test('un paiement non conforme (montant différent) est ignoré', async () => {
  h.addOrder();
  const order = await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent({ amount: 1 }) });
  assert.equal(order, null);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Non payé');
});

test('une commande remboursée ne peut pas être rouverte', async () => {
  h.addOrder({ paymentStatus: 'Remboursé', status: 'Annulée' });
  assert.equal(await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() }), null);
});
