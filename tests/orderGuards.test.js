'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateDeliveryPayment, isCashPayment } = require('../utils/orderGuards');

test('blocks online delivery before payment confirmation', () => {
  const decision = evaluateDeliveryPayment({
    nextStatus: 'Livrée',
    paymentStatus: 'Non payé',
    paymentMethod: 'card',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'PAYMENT_REQUIRED_BEFORE_DELIVERY');
});

test('allows delivery for paid online orders without recording cash', () => {
  assert.deepEqual(evaluateDeliveryPayment({
    nextStatus: 'Livrée',
    paymentStatus: 'Payé',
    paymentMethod: 'card',
  }), { allowed: true, cashPaymentCollected: false });
});

test('records cash collection only when a cash order is delivered', () => {
  assert.deepEqual(evaluateDeliveryPayment({
    nextStatus: 'Livrée',
    paymentStatus: 'Non payé',
    paymentMethod: 'cash',
  }), { allowed: true, cashPaymentCollected: true });
  assert.equal(isCashPayment(' CASH '), true);
});

test('does not finalize a refunded order as delivered', () => {
  assert.equal(evaluateDeliveryPayment({
    nextStatus: 'Livrée',
    paymentStatus: 'Remboursé',
    paymentMethod: 'cash',
  }).allowed, false);
});

test('does not add delivery restrictions to non-delivery status updates', () => {
  assert.deepEqual(evaluateDeliveryPayment({
    nextStatus: 'En livraison',
    paymentStatus: 'Non payé',
    paymentMethod: 'card',
  }), { allowed: true, cashPaymentCollected: false });
});
