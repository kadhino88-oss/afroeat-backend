'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isFullyRefundedCharge } = require('../utils/refundGuards');

test('recognizes Stripe full-refund flag', () => {
  assert.equal(isFullyRefundedCharge({ refunded: true, amount: 1000, amount_refunded: 200 }), true);
});

test('recognizes the fully-refunded amount', () => {
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 1000, amount_refunded: 1000 }), true);
});

test('does not classify a partial refund as fully refunded', () => {
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 1000, amount_refunded: 250 }), false);
});

test('rejects missing or invalid refund amounts', () => {
  assert.equal(isFullyRefundedCharge(null), false);
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 0, amount_refunded: 0 }), false);
  assert.equal(isFullyRefundedCharge({ refunded: false, amount: 'bad', amount_refunded: 'bad' }), false);
});
