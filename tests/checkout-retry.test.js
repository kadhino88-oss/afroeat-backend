'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'paymentController.js'), 'utf8');

test('nouvelle tentative de paiement : la page Stripe encore ouverte est réutilisée', () => {
  assert.match(src, /stripe\.checkout\.sessions\.retrieve\(order\.stripeCheckoutSessionId\)/);
  assert.match(src, /existing\?\.status === 'open' && existing\?\.url/);
  assert.match(src, /ORDER_ALREADY_PAID/);
});

test('la clé d’idempotence change avec la tentative et correspond à des paramètres stables', () => {
  assert.match(src, /idempotencyKey: `checkout_session_\$\{order\._id\}_\$\{req\.user\._id\}_\$\{platformTag\}_\$\{attemptTag\}_\$\{minuteBucket\}`/);
  assert.match(src, /expires_at: minuteBucket \* 60 \+ 31 \* 60/);
  assert.doesNotMatch(src, /expires_at: Math\.floor\(Date\.now\(\) \/ 1000\)/);
});
