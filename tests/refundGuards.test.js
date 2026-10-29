'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isFullyRefundedCharge } = require('../utils/refundGuards');

test('recognizes a full refund using the explicit Stripe refunded flag', () => {
  assert.equal(isFullyRefundedCharge({ refunded: true, amount: 1000, amount_refunded: 200 }), true);
});

test('recognizes a full refund when the refunded amount reaches the charge amount', () => {
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 1000, amount_refunded: 1000 }), true);
});

test('does not classify a partial refund as a full refund', () => {
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 1000, amount_refunded: 300 }), false);
});

test('rejects invalid refund data', () => {
  assert.equal(isFullyRefundedCharge(null), false);
  assert.equal(isFullyRefundedCharge({ amount: 0, amount_refunded: 0 }), false);
  assert.equal(isFullyRefundedCharge({ amount: 'invalid', amount_refunded: 10 }), false);
});
