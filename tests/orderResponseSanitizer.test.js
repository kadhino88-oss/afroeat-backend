'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeOrderForViewer } = require('../utils/orderResponseSanitizer');

const exampleOrder = () => ({
  _id: 'order_123',
  totalPrice: 42,
  stripePaymentIntentId: 'pi_secretish',
  stripeCheckoutSessionId: 'cs_private',
  stripeRestaurantTransferId: 'tr_restaurant',
  stripeCourierTransferId: 'tr_courier',
  stripeRestaurantReversalId: 'trr_private',
  stripeDisputeId: 'dp_private',
  payoutStatus: 'transferred',
  payoutError: 'internal reconciliation detail',
  payoutResolutionNote: 'admin-only note',
  marketplaceSplitCalculated: true,
  platformCommissionAmount: 5,
  restaurantEarning: 35,
  driverEarning: 2,
  platformDeliveryEarning: 1,
  commissionRateBps: 1200,
  courierPayoutRateBps: 5000,
});

test('client order responses exclude Stripe identifiers, reconciliation details and marketplace splits', () => {
  const safe = sanitizeOrderForViewer(exampleOrder(), 'client');
  assert.equal(safe.totalPrice, 42);
  for (const key of [
    'stripePaymentIntentId', 'stripeCheckoutSessionId', 'stripeRestaurantTransferId',
    'stripeCourierTransferId', 'stripeRestaurantReversalId', 'stripeDisputeId',
    'payoutStatus', 'payoutError', 'payoutResolutionNote', 'marketplaceSplitCalculated',
    'platformCommissionAmount', 'restaurantEarning', 'driverEarning',
    'platformDeliveryEarning', 'commissionRateBps', 'courierPayoutRateBps',
  ]) assert.equal(Object.hasOwn(safe, key), false, key);
});

test('restaurant responses include restaurant earnings but not courier earnings or Stripe operations', () => {
  const safe = sanitizeOrderForViewer(exampleOrder(), 'restaurant');
  assert.equal(safe.restaurantEarning, 35);
  assert.equal(safe.platformCommissionAmount, 5);
  assert.equal(safe.commissionRateBps, 1200);
  assert.equal(Object.hasOwn(safe, 'driverEarning'), false);
  assert.equal(Object.hasOwn(safe, 'platformDeliveryEarning'), false);
  assert.equal(Object.hasOwn(safe, 'stripeRestaurantTransferId'), false);
  assert.equal(Object.hasOwn(safe, 'payoutError'), false);
});

test('courier responses include courier earnings but not restaurant or platform margins', () => {
  const safe = sanitizeOrderForViewer(exampleOrder(), 'livreur');
  assert.equal(safe.driverEarning, 2);
  for (const key of [
    'restaurantEarning', 'platformCommissionAmount', 'platformDeliveryEarning',
    'commissionRateBps', 'courierPayoutRateBps', 'stripeCourierTransferId', 'payoutStatus',
  ]) assert.equal(Object.hasOwn(safe, key), false, key);
});

test('admin retains complete financial and reconciliation context', () => {
  const source = exampleOrder();
  const safe = sanitizeOrderForViewer(source, 'admin');
  assert.equal(safe.stripePaymentIntentId, 'pi_secretish');
  assert.equal(safe.stripeRestaurantTransferId, 'tr_restaurant');
  assert.equal(safe.payoutResolutionNote, 'admin-only note');
  assert.equal(safe.platformCommissionAmount, 5);
  assert.equal(safe.driverEarning, 2);
});

test('unknown roles use least-privilege client-safe filtering', () => {
  const safe = sanitizeOrderForViewer(exampleOrder(), '');
  assert.equal(Object.hasOwn(safe, 'stripePaymentIntentId'), false);
  assert.equal(Object.hasOwn(safe, 'platformCommissionAmount'), false);
  assert.equal(safe.totalPrice, 42);
});
