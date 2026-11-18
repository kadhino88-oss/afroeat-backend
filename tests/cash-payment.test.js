'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCashEligibleOrder, isCashAllowedForOrder } = require('../utils/cashPayment');

const prod = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' };
const sandbox = { NODE_ENV: 'production', AFROEAT_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_test_x' };

test('espèces en production : seulement si le restaurant encaisse lui-même', () => {
  assert.equal(isCashEligibleOrder({ selfDelivery: true }), true);
  assert.equal(isCashEligibleOrder({ fulfillment: 'pickup' }), true);
  assert.equal(isCashEligibleOrder({ fulfillment: 'delivery', selfDelivery: false }), false);
  assert.equal(isCashEligibleOrder(null), false);
  assert.equal(isCashAllowedForOrder({ selfDelivery: true }, prod), true);
  assert.equal(isCashAllowedForOrder({ fulfillment: 'delivery' }, prod), false);
});

test('espèces toujours permises dans l’environnement de test', () => {
  assert.equal(isCashAllowedForOrder({ fulfillment: 'delivery' }, sandbox), true);
});
