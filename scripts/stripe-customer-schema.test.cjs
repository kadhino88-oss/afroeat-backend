const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');

test('User schema persists Stripe customer IDs separately from Connect accounts', () => {
  const stripeCustomerId = User.schema.path('stripeCustomerId');
  const connectAccountId = User.schema.path('stripeConnectAccountId');

  assert.ok(stripeCustomerId, 'stripeCustomerId must be a declared schema path');
  assert.equal(stripeCustomerId.instance, 'String');
  assert.equal(stripeCustomerId.options.default, '');
  assert.ok(connectAccountId, 'Stripe Connect account remains a separate field');
  assert.notEqual(stripeCustomerId.path, connectAccountId.path);
});
