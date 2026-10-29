'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRequestedOrderItems,
  buildTrustedOrderItems,
  calculateRestaurantPricing,
} = require('../utils/orderPricing');

const validId = (value) => /^[a-f\\d]{24}$/i.test(String(value || ''));
const restaurantId = '650000000000000000000001';
const menuA = {
  _id: '650000000000000000000011',
  restaurant: restaurantId,
  name: 'Poulet braisé',
  price: 15.5,
  image: 'menu-image.jpg',
  available: true,
};

test('normalizes item IDs and rejects non-integer or excessive quantities', () => {
  const parsed = normalizeRequestedOrderItems([
    { menuItem: menuA._id, quantity: 2, price: 0.01, name: 'fake' },
  ], validId);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.items, [{ menuItem: menuA._id, quantity: 2, notes: '' }]);

  assert.equal(normalizeRequestedOrderItems([{ menuItem: menuA._id, quantity: 1.5 }], validId).code, 'INVALID_ITEM_QUANTITY');
  assert.equal(normalizeRequestedOrderItems([{ menuItem: menuA._id, quantity: 51 }], validId).code, 'INVALID_ITEM_QUANTITY');
  assert.equal(normalizeRequestedOrderItems([{ menuItem: 'not-an-id', quantity: 1 }], validId).code, 'INVALID_MENU_ITEM_ID');
});

test('uses menu-record price, name and image instead of client-supplied values', () => {
  const parsed = normalizeRequestedOrderItems([
    { menuItem: menuA._id, quantity: 2, price: 0.01, name: 'Fake cheap meal', image: 'fake.jpg' },
  ], validId);
  const trusted = buildTrustedOrderItems({
    requestedItems: parsed.items,
    menuItems: [menuA],
    restaurantId,
  });
  assert.equal(trusted.ok, true);
  assert.deepEqual(trusted.items[0], {
    menuItem: menuA._id,
    name: 'Poulet braisé',
    quantity: 2,
    price: 15.5,
    image: 'menu-image.jpg',
    notes: '',
  });
  assert.equal(trusted.subtotal, 31);
});

test('rejects unavailable items and items belonging to another restaurant', () => {
  const parsed = normalizeRequestedOrderItems([
    { menuItem: menuA._id, quantity: 1 },
  ], validId);
  assert.equal(buildTrustedOrderItems({
    requestedItems: parsed.items,
    menuItems: [{ ...menuA, available: false }],
    restaurantId,
  }).code, 'MENU_ITEM_UNAVAILABLE');
  assert.equal(buildTrustedOrderItems({
    requestedItems: parsed.items,
    menuItems: [{ ...menuA, restaurant: '650000000000000000000099' }],
    restaurantId,
  }).code, 'MENU_ITEM_UNAVAILABLE');
});

test('uses restaurant currency and delivery fee to calculate order total', () => {
  const pricing = calculateRestaurantPricing({
    items: [{ price: 15.5, quantity: 2 }],
    restaurant: { currency: 'CHF', deliveryFee: 3.25, minimumOrderAmount: 20 },
  });
  assert.equal(pricing.ok, true);
  assert.equal(pricing.subtotal, 31);
  assert.equal(pricing.deliveryFee, 3.25);
  assert.equal(pricing.totalPrice, 34.25);
  assert.equal(pricing.currency, 'CHF');
  assert.equal(pricing.driverEarning, 3.25);
});

test('rejects order below restaurant minimum and unsupported currency', () => {
  assert.equal(calculateRestaurantPricing({
    items: [{ price: 10, quantity: 1 }],
    restaurant: { currency: 'EUR', deliveryFee: 2, minimumOrderAmount: 15 },
  }).code, 'MINIMUM_ORDER_NOT_MET');
  assert.equal(calculateRestaurantPricing({
    items: [{ price: 10, quantity: 1 }],
    restaurant: { currency: 'ZZZ', deliveryFee: 0, minimumOrderAmount: 0 },
  }).code, 'UNSUPPORTED_CURRENCY');
});
