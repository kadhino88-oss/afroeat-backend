'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTransferCountryAllowed,
  isPartnerReadyForTransfers,
  toStripeAmount,
  isPartialRefundCharge,
  isConnectPayoutsEnabled,
  validatePayoutPaymentIntent,
} = require('../utils/marketplacePayouts');

const envKeys = [
  'STRIPE_CONNECT_PAYOUTS_ENABLED',
  'STRIPE_SECRET_KEY',
  'NODE_ENV',
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

test('classifies partial refunds even before any transfer exists', () => {
  assert.equal(isPartialRefundCharge({ amount: 10000, amount_refunded: 1000 }), true);
  assert.equal(isPartialRefundCharge({ amount: 10000, amount_refunded: 10000 }), false);
  assert.equal(isPartialRefundCharge({ amount: 10000, amount_refunded: 0 }), false);
  assert.equal(isPartialRefundCharge({ amount: 0, amount_refunded: 0 }), false);
  assert.equal(isPartialRefundCharge({ amount: 10000, amount_refunded: NaN }), false);
});

test('Connect payouts require explicit opt-in and an environment-matching Stripe key', () => {
  withEnv({
    NODE_ENV: 'test',
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'false',
    STRIPE_SECRET_KEY: 'sk_test_unit',
  }, () => {
    assert.equal(isConnectPayoutsEnabled(), false);
  });

  withEnv({
    NODE_ENV: 'test',
    STRIPE_SECRET_KEY: 'sk_test_unit',
  }, () => {
    delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED;
    assert.equal(isConnectPayoutsEnabled(), false);
  });

  withEnv({
    NODE_ENV: 'test',
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_unit',
  }, () => {
    assert.equal(isConnectPayoutsEnabled(), true);
  });

  withEnv({
    NODE_ENV: 'test',
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_live_unit',
  }, () => {
    assert.equal(isConnectPayoutsEnabled(), false);
  });

  withEnv({
    NODE_ENV: 'production',
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_unit',
  }, () => {
    assert.equal(isConnectPayoutsEnabled(), false);
  });

  withEnv({
    NODE_ENV: 'production',
    STRIPE_CONNECT_PAYOUTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_live_unit',
  }, () => {
    assert.equal(isConnectPayoutsEnabled(), true);
  });
});


test('payout validation binds a succeeded PaymentIntent to the stored order and amount', () => {
  const order = {
    _id: '650000000000000000000001',
    user: '650000000000000000000002',
    totalPrice: 24.5,
    currency: 'CHF',
    stripePaymentIntentId: 'pi_expected',
  };
  const intent = {
    id: 'pi_expected',
    status: 'succeeded',
    metadata: {
      orderId: order._id,
      userId: order.user,
    },
    amount: 2450,
    currency: 'chf',
    latest_charge: { id: 'ch_expected' },
  };

  assert.deepEqual(validatePayoutPaymentIntent(order, intent), {
    valid: true,
    reason: null,
    chargeId: 'ch_expected',
  });
});

test('payout validation rejects a successful intent if amount, currency, order or user differ', () => {
  const order = {
    _id: '650000000000000000000001',
    user: '650000000000000000000002',
    totalPrice: 24.5,
    currency: 'CHF',
    stripePaymentIntentId: 'pi_expected',
  };
  const intent = {
    id: 'pi_expected',
    status: 'succeeded',
    metadata: {
      orderId: order._id,
      userId: order.user,
    },
    amount: 2450,
    currency: 'chf',
    latest_charge: { id: 'ch_expected' },
  };
  const invalidIntents = [
    { ...intent, amount: 1 },
    { ...intent, currency: 'eur' },
    { ...intent, metadata: { ...intent.metadata, orderId: '650000000000000000000099' } },
    { ...intent, metadata: { ...intent.metadata, userId: '650000000000000000000099' } },
    { ...intent, status: 'processing' },
    { ...intent, id: 'pi_other' },
  ];

  for (const invalidIntent of invalidIntents) {
    assert.equal(validatePayoutPaymentIntent(order, invalidIntent).valid, false);
  }
});

test('payout validation blocks an otherwise valid intent when no charge is attached', () => {
  const order = {
    _id: '650000000000000000000001',
    user: '650000000000000000000002',
    totalPrice: 24.5,
    currency: 'CHF',
    stripePaymentIntentId: 'pi_expected',
  };
  const intent = {
    id: 'pi_expected',
    status: 'succeeded',
    metadata: {
      orderId: order._id,
      userId: order.user,
    },
    amount: 2450,
    currency: 'chf',
    latest_charge: null,
  };

  assert.deepEqual(validatePayoutPaymentIntent(order, intent), {
    valid: false,
    reason: 'charge_missing',
    chargeId: null,
  });
});
