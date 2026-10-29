'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePaymentChannel } = require('../utils/paymentChannel');

test('permits a first payment channel when no method is selected', () => {
  assert.equal(evaluatePaymentChannel({
    paymentMethod: null,
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
  }, 'card').allowed, true);
  assert.equal(evaluatePaymentChannel({
    paymentMethod: null,
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
  }, 'stripe_checkout').allowed, true);
});

test('allows retries on the same stored payment channel', () => {
  assert.equal(evaluatePaymentChannel({
    paymentMethod: 'card',
    stripePaymentIntentId: 'pi_123',
    stripeCheckoutSessionId: null,
  }, 'card').allowed, true);
  assert.equal(evaluatePaymentChannel({
    paymentMethod: 'stripe_checkout',
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: 'cs_123',
  }, 'stripe_checkout').allowed, true);
});

test('rejects switching from card to Checkout or Checkout to card', () => {
  assert.equal(evaluatePaymentChannel({
    paymentMethod: 'card',
    stripePaymentIntentId: 'pi_123',
    stripeCheckoutSessionId: null,
  }, 'stripe_checkout').code, 'PAYMENT_METHOD_LOCKED');
  assert.equal(evaluatePaymentChannel({
    paymentMethod: 'stripe_checkout',
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: 'cs_123',
  }, 'card').code, 'PAYMENT_METHOD_LOCKED');
});

test('rejects switching away from an already selected cash method', () => {
  assert.equal(evaluatePaymentChannel({
    paymentMethod: 'cash',
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
  }, 'card').code, 'PAYMENT_METHOD_LOCKED');
});

test('rejects unknown payment channels and missing orders', () => {
  assert.equal(evaluatePaymentChannel(null, 'card').code, 'INVALID_PAYMENT_CHANNEL');
  assert.equal(evaluatePaymentChannel({}, 'cash').code, 'INVALID_PAYMENT_CHANNEL');
});
