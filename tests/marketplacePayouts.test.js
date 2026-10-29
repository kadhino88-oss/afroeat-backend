'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTransferCountryAllowed,
  isPartnerReadyForTransfers,
  toStripeAmount,
} = require('../utils/marketplacePayouts');

const envKeys = [
  'STRIPE_CONNECT_PAYOUTS_ENABLED',
  'STRIPE_PLATFORM_COUNTRY',
  'STRIPE_CONNECT_COUNTRIES',
  'STRIPE_CONNECT_CROSS_BORDER_COUNTRIES',
];

const withEnv = (overrides, callback) => {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return callback();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test('Stripe transfer countries require the allow-list and platform/cross-border policy', () => {
  const env = {
    STRIPE_PLATFORM_COUNTRY: 'CH',
    STRIPE_CONNECT_COUNTRIES: 'CH,FR,GB',
    STRIPE_CONNECT_CROSS_BORDER_COUNTRIES: 'FR',
  };
  assert.equal(isTransferCountryAllowed('CH', env), true);
  assert.equal(isTransferCountryAllowed('FR', env), true);
  assert.equal(isTransferCountryAllowed('GB', env), false);
  assert.equal(isTransferCountryAllowed('US', env), false);
  assert.equal(isTransferCountryAllowed('', env), false);
});

test('production transfer eligibility requires a ready Connect account and allowed country', () => {
  withEnv({
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'true',
    STRIPE_PLATFORM_COUNTRY: 'CH',
    STRIPE_CONNECT_COUNTRIES: 'CH,FR',
    STRIPE_CONNECT_CROSS_BORDER_COUNTRIES: 'FR',
  }, () => {
    const ready = {
      stripeConnectAccountId: 'acct_123',
      stripeConnectTransfersEnabled: true,
      stripeConnectPayoutsEnabled: true,
      countryCode: 'FR',
    };
    assert.equal(isPartnerReadyForTransfers(ready), true);
    assert.equal(isPartnerReadyForTransfers({ ...ready, countryCode: 'GB' }), false);
    assert.equal(isPartnerReadyForTransfers({ ...ready, stripeConnectPayoutsEnabled: false }), false);
    assert.equal(isPartnerReadyForTransfers({ ...ready, stripeConnectTransfersEnabled: false }), false);
    assert.equal(isPartnerReadyForTransfers({ ...ready, stripeConnectAccountId: '' }), false);
  });
});

test('Stripe amounts use zero decimals for XOF/XAF and cents for supported decimal currencies', () => {
  assert.equal(toStripeAmount(12.34, 'EUR'), 1234);
  assert.equal(toStripeAmount(12, 'XOF'), 12);
  assert.equal(toStripeAmount(12, 'XAF'), 12);
  assert.equal(toStripeAmount(0, 'EUR'), null);
  assert.equal(toStripeAmount(-1, 'EUR'), null);
  assert.equal(toStripeAmount(2, 'XYZ'), null);
  assert.equal(toStripeAmount(Number.MAX_VALUE, 'EUR'), null);
});

