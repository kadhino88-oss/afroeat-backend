'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMatchingPaymentIntent,
  isMatchingCheckoutSession,
} = require('../utils/paymentValidation');

const toStripeAmount = (amount, currency) => {
  if (currency === 'XOF' || currency === 'XAF') return Math.round(amount);
  if (['EUR', 'USD', 'GBP', 'CHF', 'CAD'].includes(currency)) return Math.round(amount * 100);
  return null;
};

const order = () => ({
  _id: '650000000000000000000001',
  user: '650000000000000000000002',
  totalPrice: 24.5,
  currency: 'CHF',
  stripePaymentIntentId: 'pi_expected',
  stripeCheckoutSessionId: 'cs_expected',
});

const intent = () => ({
  id: 'pi_expected',
  status: 'succeeded',
  metadata: {
    orderId: '650000000000000000000001',
    userId: '650000000000000000000002',
  },
  amount: 2450,
  currency: 'chf',
});

const session = () => ({
  id: 'cs_expected',
  mode: 'payment',
  payment_status: 'paid',
  client_reference_id: '650000000000000000000001',
  metadata: {
    orderId: '650000000000000000000001',
    userId: '650000000000000000000002',
  },
  amount_total: 2450,
  currency: 'chf',
});

test('accepts a PaymentIntent bound to the stored order, owner, amount and currency', () => {
  assert.equal(isMatchingPaymentIntent({ order: order(), paymentIntent: intent(), toStripeAmount }), true);
});

test('rejects a successful PaymentIntent with the wrong stored ID', () => {
  const record = order();
  record.stripePaymentIntentId = 'pi_different';
  assert.equal(isMatchingPaymentIntent({ order: record, paymentIntent: intent(), toStripeAmount }), false);
});

test('rejects a PaymentIntent with a mismatched amount, currency, order or owner', () => {
  const cases = [
    { ...intent(), amount: 1 },
    { ...intent(), currency: 'eur' },
    { ...intent(), metadata: { ...intent().metadata, orderId: '650000000000000000000099' } },
    { ...intent(), metadata: { ...intent().metadata, userId: '650000000000000000000099' } },
    { ...intent(), status: 'processing' },
  ];
  for (const paymentIntent of cases) {
    assert.equal(isMatchingPaymentIntent({ order: order(), paymentIntent, toStripeAmount }), false);
  }
});

test('accepts a Checkout Session bound to the stored order, owner, amount and currency', () => {
  assert.equal(isMatchingCheckoutSession({ order: order(), checkoutSession: session(), toStripeAmount }), true);
});

test('rejects a Checkout Session with a mismatched stored ID, amount or unpaid status', () => {
  const wrongIdOrder = order();
  wrongIdOrder.stripeCheckoutSessionId = 'cs_other';
  assert.equal(isMatchingCheckoutSession({ order: wrongIdOrder, checkoutSession: session(), toStripeAmount }), false);
  assert.equal(isMatchingCheckoutSession({ order: order(), checkoutSession: { ...session(), amount_total: 1 }, toStripeAmount }), false);
  assert.equal(isMatchingCheckoutSession({ order: order(), checkoutSession: { ...session(), payment_status: 'unpaid' }, toStripeAmount }), false);
});

test('rejects currencies that have no Stripe amount configuration', () => {
  const record = order();
  record.currency = 'ZZZ';
  assert.equal(isMatchingPaymentIntent({ order: record, paymentIntent: intent(), toStripeAmount }), false);
});
