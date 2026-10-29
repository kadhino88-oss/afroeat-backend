'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeIdempotencyKey,
  createOrderRequestFingerprint,
} = require('../utils/orderIdempotency');

const sample = () => ({
  restaurant: '650000000000000000000001',
  items: [
    { menuItem: '650000000000000000000011', quantity: 2, notes: 'sans piment' },
  ],
  deliveryAddress: 'Rue du Lac 10, Genève',
  notes: 'Sonner à la porte',
});

test('accepts a stable, bounded idempotency key', () => {
  assert.deepEqual(normalizeIdempotencyKey('checkout-abc-123'), {
    ok: true,
    key: 'checkout-abc-123',
  });
  assert.equal(normalizeIdempotencyKey('x'.repeat(129)).code, 'INVALID_IDEMPOTENCY_KEY');
  assert.equal(normalizeIdempotencyKey('key\nsecond-line').code, 'INVALID_IDEMPOTENCY_KEY');
});

test('omits optional idempotency when the caller supplies no key', () => {
  assert.deepEqual(normalizeIdempotencyKey(undefined), { ok: true, key: null });
  assert.deepEqual(normalizeIdempotencyKey('  '), { ok: true, key: null });
});

test('same normalized order request has the same fingerprint', () => {
  assert.equal(
    createOrderRequestFingerprint(sample()),
    createOrderRequestFingerprint(sample())
  );
});

test('changed item quantity, address or notes changes the request fingerprint', () => {
  const original = createOrderRequestFingerprint(sample());
  assert.notEqual(createOrderRequestFingerprint({
    ...sample(),
    items: [{ ...sample().items[0], quantity: 3 }],
  }), original);
  assert.notEqual(createOrderRequestFingerprint({
    ...sample(),
    deliveryAddress: 'Another street 5',
  }), original);
  assert.notEqual(createOrderRequestFingerprint({
    ...sample(),
    notes: 'Different delivery note',
  }), original);
});

test('client-supplied prices and labels do not affect the request fingerprint', () => {
  const first = sample();
  const second = sample();
  first.items[0].price = 0.01;
  first.items[0].name = 'Fake name';
  second.items[0].price = 9000;
  second.items[0].name = 'Other fake name';
  assert.equal(
    createOrderRequestFingerprint(first),
    createOrderRequestFingerprint(second)
  );
});
