'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceRequestedOrderItems } = require('../utils/orderPricing');

const persistedMenu = [
  { _id: 'dish-a', name: 'Attiéké poisson', price: 18.25, image: 'https://cdn.example/dish-a.jpg' },
  { _id: 'dish-b', name: 'Alloco', price: 6, image: '' },
];

test('uses database menu names and prices instead of client-supplied values', () => {
  const requested = [
    { menuItem: 'dish-a', name: 'Cheap fake name', price: 0.01, quantity: 2, image: 'fake.jpg', notes: 'sans piment' },
    { menuItem: 'dish-b', name: 'Free dish', price: 0, quantity: 1 },
  ];
  const result = priceRequestedOrderItems(requested, persistedMenu);

  assert.ok(result);
  assert.equal(result.items[0].name, 'Attiéké poisson');
  assert.equal(result.items[0].price, 18.25);
  assert.equal(result.items[0].image, 'https://cdn.example/dish-a.jpg');
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].notes, 'sans piment');
  assert.equal(result.items[1].name, 'Alloco');
  assert.equal(result.items[1].price, 6);
  assert.equal(result.itemsSubtotal, 42.5);
});

test('returns null when any requested menu item is missing from the persisted menu result', () => {
  const result = priceRequestedOrderItems(
    [{ menuItem: 'dish-a', quantity: 1 }, { menuItem: 'dish-missing', quantity: 1 }],
    persistedMenu
  );
  assert.equal(result, null);
});

test('rejects invalid persisted menu prices or missing menu names', () => {
  assert.equal(
    priceRequestedOrderItems([{ menuItem: 'dish-a', quantity: 1 }], [
      { _id: 'dish-a', name: 'Dish', price: 'NaN' },
    ]),
    null
  );
  assert.equal(
    priceRequestedOrderItems([{ menuItem: 'dish-a', quantity: 1 }], [
      { _id: 'dish-a', name: ' ', price: 5 },
    ]),
    null
  );
  assert.equal(
    priceRequestedOrderItems([{ menuItem: 'dish-a', quantity: 1 }], [
      { _id: 'dish-a', name: 'Dish', price: -1 },
    ]),
    null
  );
});

test('returns null for non-array arguments and rounds the calculated subtotal to cents', () => {
  assert.equal(priceRequestedOrderItems(null, persistedMenu), null);
  assert.equal(priceRequestedOrderItems([], null), null);
  const result = priceRequestedOrderItems([
    { menuItem: 'dish-a', quantity: 1 },
  ], [{ _id: 'dish-a', name: 'Dish', price: 2.335 }]);
  assert.ok(result);
  assert.equal(result.items[0].price, 2.34);
  assert.equal(result.itemsSubtotal, 2.34);
});
