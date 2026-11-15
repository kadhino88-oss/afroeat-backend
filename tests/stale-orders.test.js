const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldRefund, refundCancelledOrder } = require('../utils/orderRefund');
const { expireStaleOrders } = require('../utils/staleOrders');

const makeOrder = (over = {}) => ({
  _id: 'o1', status: 'En attente', paymentStatus: 'Payé', paymentMethod: 'stripe_checkout',
  stripePaymentIntentId: 'pi_123', statusHistory: [], user: 'u1',
  save: async function () { return this; }, ...over,
});

test('remboursement seulement pour une commande payée, annulée et non remboursée', () => {
  assert.equal(shouldRefund(makeOrder({ status: 'Annulée' })), true);
  assert.equal(shouldRefund(makeOrder({ status: 'Confirmée' })), false);
  assert.equal(shouldRefund(makeOrder({ status: 'Annulée', paymentStatus: 'Non payé' })), false);
  assert.equal(shouldRefund(makeOrder({ status: 'Annulée', stripePaymentIntentId: '' })), false);
  assert.equal(shouldRefund(makeOrder({ status: 'Annulée', refundedAt: new Date() })), false);
  assert.equal(shouldRefund(makeOrder({ status: 'Annulée', refundRequestedAt: new Date() })), false);
});

test('le remboursement Stripe est idempotent et tracé', async () => {
  const calls = [];
  const stripe = { refunds: { create: async (...a) => { calls.push(a); return {}; } } };
  const order = makeOrder({ status: 'Annulée' });
  const r = await refundCancelledOrder(order, stripe);
  assert.equal(r.refunded, true);
  assert.equal(calls[0][0].payment_intent, 'pi_123');
  assert.equal(calls[0][1].idempotencyKey, 'refund_order_o1');
  assert.ok(order.refundRequestedAt);
  assert.equal((await refundCancelledOrder(order, stripe)).refunded, false); // pas de double remboursement
});

test('un échec Stripe est conservé pour l’administration', async () => {
  const stripe = { refunds: { create: async () => { throw new Error('charge_already_refunded'); } } };
  const order = makeOrder({ status: 'Annulée' });
  const r = await refundCancelledOrder(order, stripe);
  assert.equal(r.refunded, false);
  assert.match(order.refundError, /charge_already_refunded/);
});

test('commandes sans réponse : annulées et remboursées ; paiement abandonné : annulées sans remboursement', async () => {
  const paid = makeOrder();
  const abandoned = makeOrder({ _id: 'o2', paymentStatus: 'Non payé', stripePaymentIntentId: '' });
  const refunds = [];
  const stripe = { refunds: { create: async (p) => { refunds.push(p.payment_intent); return {}; } } };
  const Order = {
    find: (q) => ({ limit: async () => (q.paymentStatus === 'Payé' ? [paid] : [abandoned]) }),
  };
  const notified = [];
  const out = await expireStaleOrders({ Order, stripe, notify: async (o) => notified.push(o._id) });
  assert.deepEqual(out, { unanswered: 1, unpaid: 1, refunded: 1 });
  assert.equal(paid.status, 'Annulée');
  assert.equal(paid.statusHistory[0].updatedByRole, 'system');
  assert.deepEqual(refunds, ['pi_123']);
  assert.equal(abandoned.status, 'Annulée');
  assert.deepEqual(notified, ['o1']);
});
