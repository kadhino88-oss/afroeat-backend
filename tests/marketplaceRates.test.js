'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMarketplaceRates, MAX_BASIS_POINTS } = require('../config/marketplaceRates');

test('normalizes currency codes and accepts valid basis-point rates', () => {
  assert.deepEqual(loadMarketplaceRates(JSON.stringify({
    eur: { commissionBps: 1200, courierPayoutBps: 7500 },
    CHF: { commissionBps: 1000, courierPayoutBps: 7000 },
  })), {
    EUR: { commissionBps: 1200, courierPayoutBps: 7500 },
    CHF: { commissionBps: 1000, courierPayoutBps: 7000 },
  });
});

test('returns an empty configuration when no rates are supplied', () => {
  assert.deepEqual(loadMarketplaceRates(''), {});
  assert.equal(MAX_BASIS_POINTS, 10000);
});

test('rejects malformed JSON, arrays, and invalid currency codes', () => {
  assert.throws(() => loadMarketplaceRates('{invalid'), /JSON valide/);
  assert.throws(() => loadMarketplaceRates('[]'), /objet indexé/);
  assert.throws(() => loadMarketplaceRates(JSON.stringify({
    EU: { commissionBps: 1000, courierPayoutBps: 7000 },
  })), /Devise invalide/);
});

test('rejects missing, fractional, negative and over-limit rates', () => {
  const invalidRates = [
    { commissionBps: 1000 },
    { commissionBps: 1000, courierPayoutBps: 7000.5 },
    { commissionBps: -1, courierPayoutBps: 7000 },
    { commissionBps: 10001, courierPayoutBps: 7000 },
    { commissionBps: 1000, courierPayoutBps: -1 },
    { commissionBps: 1000, courierPayoutBps: 10001 },
  ];

  for (const rates of invalidRates) {
    assert.throws(() => loadMarketplaceRates(JSON.stringify({ EUR: rates })), /commissionBps|courierPayoutBps/);
  }
});

test('rejects a rates entry that is not an object', () => {
  assert.throws(() => loadMarketplaceRates(JSON.stringify({ EUR: 42 })), /Configuration de taux invalide/);
});
