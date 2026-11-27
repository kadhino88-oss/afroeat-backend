'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cashDecision, isCashAllowedForOrder } = require('../utils/cashPayment');
const { availableOrderFilter } = require('../utils/courierDispatch');

test('espèces : le restaurant encaisse en livraison par lui-même ou en retrait', () => {
  assert.deepEqual(cashDecision({ selfDelivery: true, totalPrice: 500 }), { allowed: true, holder: 'restaurant' });
  assert.deepEqual(cashDecision({ fulfillment: 'pickup', totalPrice: 500 }), { allowed: true, holder: 'restaurant' });
});

test('espèces : un livreur AFROEAT peut encaisser, dans la limite du plafond', () => {
  assert.deepEqual(cashDecision({ fulfillment: 'delivery', totalPrice: 40 }), { allowed: true, holder: 'courier' });
  const over = cashDecision({ fulfillment: 'delivery', totalPrice: 90 });
  assert.equal(over.allowed, false);
  assert.equal(over.code, 'CASH_LIMIT_EXCEEDED');
  assert.equal(isCashAllowedForOrder({ totalPrice: 90 }, { CASH_COURIER_MAX_TOTAL: '100' }), true);
});

test('une commande en espèces est proposée aux livreurs sans paiement préalable', () => {
  const filter = availableOrderFilter(Date.now());
  assert.match(JSON.stringify(filter), /"paymentMethod":"cash"/);
  assert.match(JSON.stringify(filter), /"paymentStatus":"Payé"/);
});

test('en vraie production, les espèces restent fermées sauf CASH_PAYMENTS_ENABLED=true', () => {
  const { isCashEnabled } = require('../utils/cashPayment');
  const prod = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' };
  assert.equal(isCashEnabled(prod), false);
  assert.equal(cashDecision({ selfDelivery: true, totalPrice: 10 }, prod).code, 'CASH_ON_DELIVERY_DISABLED');
  assert.equal(isCashEnabled({ ...prod, CASH_PAYMENTS_ENABLED: 'true' }), true);
  assert.equal(cashDecision({ selfDelivery: true, totalPrice: 10 }, { ...prod, CASH_PAYMENTS_ENABLED: 'true' }).allowed, true);
  assert.equal(isCashEnabled({ NODE_ENV: 'development' }), true); // hors production : inchangé
});
