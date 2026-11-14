'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isProductionLocked,
  isStagingSandbox,
  isRealProduction,
  isLiveCommerceOpen,
} = require('../utils/runtimeEnvironment');

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
    assert.match(src, /isProductionLocked|isRealProduction/, file);
  }
});

const live = (extra) => env({
  AFROEAT_LIVE_COMMERCE: 'open',
  STRIPE_SECRET_KEY: 'sk_live_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc',
  MARKETPLACE_RATES_JSON: '{"CHF":{"commissionBps":1500,"courierPayoutBps":8000}}',
  ...extra,
});

test('vraie production : ouverte seulement avec la décision explicite ET la configuration complète', () => {
  assert.equal(isLiveCommerceOpen(live({})), true);
  assert.equal(isProductionLocked(live({})), false);
  assert.equal(isRealProduction(live({})), true);
});

test('vraie production : reste verrouillée si un seul élément manque', () => {
  assert.equal(isProductionLocked(live({ AFROEAT_LIVE_COMMERCE: '' })), true);
  assert.equal(isProductionLocked(live({ AFROEAT_LIVE_COMMERCE: 'true' })), true);
  assert.equal(isProductionLocked(live({ STRIPE_SECRET_KEY: 'sk_test_abc' })), true);
  assert.equal(isProductionLocked(live({ STRIPE_SECRET_KEY: '' })), true);
  assert.equal(isProductionLocked(live({ STRIPE_WEBHOOK_SECRET: '' })), true);
  assert.equal(isProductionLocked(live({ MARKETPLACE_RATES_JSON: '' })), true);
});

test('la décision d’ouverture ne change rien hors production réelle', () => {
  assert.equal(isLiveCommerceOpen({ NODE_ENV: 'development', AFROEAT_LIVE_COMMERCE: 'open', STRIPE_SECRET_KEY: 'sk_live_abc' }), false);
  assert.equal(isLiveCommerceOpen(live({ AFROEAT_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_test_abc' })), false);
});

test('le paiement à la livraison et les versements suivent la vraie production, pas le verrou', () => {
  const pay = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'paymentController.js'), 'utf8');
  assert.match(pay, /const selectCashPayment = async \(req, res\) => \{\s+if \(isRealProduction\(\)\)/);
  assert.match(pay, /cash: !isRealProduction\(\)/);
  assert.match(pay, /hasStripeTestSecret\(\) \|\| isLiveCommerceOpen\(\)/);
  const payouts = fs.readFileSync(path.join(__dirname, '..', 'utils', 'marketplacePayouts.js'), 'utf8');
  assert.match(payouts, /if \(isRealProduction\(\)\) \{\s+return secretKey\.startsWith\('sk_live_'\)/);
});
