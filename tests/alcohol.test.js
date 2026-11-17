const test = require('node:test');
const assert = require('node:assert/strict');
const { orderContainsAlcohol, isAgeConfirmed, ageCheckError } = require('../utils/alcohol');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');

test('une commande avec une boisson alcoolisée est repérée', () => {
  assert.equal(orderContainsAlcohol([{ containsAlcohol: false }, { containsAlcohol: true }]), true);
  assert.equal(orderContainsAlcohol([{ containsAlcohol: false }, {}]), false);
  assert.equal(orderContainsAlcohol(null), false);
});

test('seule une confirmation explicite de majorité est acceptée', () => {
  assert.equal(isAgeConfirmed(true), true);
  assert.equal(isAgeConfirmed('true'), true);
  assert.equal(isAgeConfirmed('yes'), false);
  assert.equal(isAgeConfirmed(undefined), false);
  assert.equal(ageCheckError().code, 'AGE_CONFIRMATION_REQUIRED');
});

test('les modèles portent les champs alcool', () => {
  assert.equal(new MenuItem({}).containsAlcohol, false);
  const order = new Order({});
  assert.equal(order.containsAlcohol, false);
  assert.equal(order.ageConfirmedAt, null);
});

test('la commande refuse l’alcool sans confirmation et la trace sinon', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../controllers/orderController.js'), 'utf8');
  assert.match(src, /containsAlcohol && !isAgeConfirmed\(req\.body\?\.ageConfirmed\)/);
  assert.match(src, /ageConfirmedAt: containsAlcohol \? new Date\(\) : null/);
  assert.equal((src.match(/available containsAlcohol'\)/g) || []).length, 2);
});
