'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isProductionLocked, isStagingSandbox } = require('../utils/runtimeEnvironment');

const env = (extra) => ({ NODE_ENV: 'production', ...extra });

test('production sans AFROEAT_ENV : verrous marketplace fermés (même avec une clé de test)', () => {
  assert.equal(isProductionLocked(env({ STRIPE_SECRET_KEY: 'sk_test_abc' })), true);
  assert.equal(isProductionLocked(env({})), true);
});

test('staging + clé de TEST : verrous levés (aucun paiement réel possible)', () => {
  const e = env({ AFROEAT_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_test_abc' });
  assert.equal(isStagingSandbox(e), true);
  assert.equal(isProductionLocked(e), false);
  assert.equal(isProductionLocked(env({ AFROEAT_ENV: ' Staging ', STRIPE_SECRET_KEY: 'rk_test_abc' })), false);
});

test('staging + clé LIVE ou sans clé : verrous restent fermés', () => {
  assert.equal(isProductionLocked(env({ AFROEAT_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_live_abc' })), true);
  assert.equal(isProductionLocked(env({ AFROEAT_ENV: 'staging' })), true);
  assert.equal(isProductionLocked(env({ AFROEAT_ENV: 'prod', STRIPE_SECRET_KEY: 'sk_test_abc' })), true);
});

test('hors production : pas de verrou', () => {
  assert.equal(isProductionLocked({ NODE_ENV: 'development' }), false);
  assert.equal(isProductionLocked({}), false);
});

test('commande, paiement et versements passent tous par le même verrou', () => {
  for (const file of ['controllers/paymentController.js', 'controllers/orderController.js', 'utils/marketplacePayouts.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, /NODE_ENV\s*[!=]==\s*'production'/, file);
    assert.match(src, /isProductionLocked/, file);
  }
});
