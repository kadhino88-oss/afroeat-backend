'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createOrderRequestFingerprint,
  isValidIdempotencyKey,
} = require('../utils/orderIdempotency');

const baseRequest = () => ({
  restaurant: 'restaurant-1',
  items: [
    { menuItem: 'dish-1', quantity: 2, notes: 'sans piment' },
    { menuItem: 'dish-2', quantity: 1, notes: '' },
  ],
  deliveryAddress: '12 rue de Genève, Annemasse',
  notes: 'Sonner en arrivant',
});

test('the same order request produces a stable fingerprint', () => {
  assert.equal(
    createOrderRequestFingerprint(baseRequest()),
    createOrderRequestFingerprint(baseRequest())
  );
});

test('the fingerprint changes with restaurant, items, quantities, notes or address', () => {
  const original = createOrderRequestFingerprint(baseRequest());
  const request = baseRequest();
  const variants = [
    { ...baseRequest(), restaurant: 'restaurant-2' },
    { ...baseRequest(), items: [{ ...request.items[0], menuItem: 'dish-3' }, request.items[1]] },
    { ...baseRequest(), items: [{ ...request.items[0], quantity: 3 }, request.items[1]] },
    { ...baseRequest(), items: [{ ...request.items[0], notes: 'extra piment' }, request.items[1]] },
    { ...baseRequest(), deliveryAddress: '13 rue de Genève, Annemasse' },
    { ...baseRequest(), notes: 'Laisser à la porte' },
  ];

  for (const variant of variants) {
    assert.notEqual(createOrderRequestFingerprint(variant), original);
  }
});

test('item order is included in the fingerprint', () => {
  const request = baseRequest();
  assert.notEqual(
    createOrderRequestFingerprint(request),
    createOrderRequestFingerprint({ ...request, items: [...request.items].reverse() })
  );
});

test('non-empty idempotency keys up to 128 characters are accepted', () => {
  assert.equal(isValidIdempotencyKey('afroeat-checkout-123'), true);
  assert.equal(isValidIdempotencyKey('k'.repeat(128)), true);
});

test('empty, oversized and CR/LF-containing keys are rejected', () => {
  assert.equal(isValidIdempotencyKey(''), false);
  assert.equal(isValidIdempotencyKey('k'.repeat(129)), false);
  assert.equal(isValidIdempotencyKey('bad\nkey'), false);
  assert.equal(isValidIdempotencyKey('bad\rkey'), false);
  assert.equal(isValidIdempotencyKey(null), false);
});
