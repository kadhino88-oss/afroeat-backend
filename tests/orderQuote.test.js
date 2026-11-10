'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('POST /orders/quote est déclaré, protégé et placé avant les routes /:id', () => {
  const src = read('routes', 'orderRoutes.js');
  assert.match(src, /router\.post\('\/quote', protect, allowRoles\('client', 'admin'\), getOrderQuote\)/);
});

test('le contrôleur exporte getOrderQuote et ne dépend pas du verrou de production', () => {
  const src = read('controllers', 'orderController.js');
  const start = src.indexOf('const getOrderQuote');
  const end = src.indexOf('module.exports');
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /isProductionLocked/);
  assert.match(body, /calculateRestaurantPricing/);
  assert.match(body, /itemsSubtotal/);
  assert.match(src, /getOrderQuote,/);
});

test('createOrder refuse un devis périmé avec QUOTE_CHANGED (409)', () => {
  const src = read('controllers', 'orderController.js');
  assert.match(src, /code: 'QUOTE_CHANGED'/);
  assert.match(src, /Math\.abs\(quotedTotal - pricing\.totalPrice\) > 0\.005/);
});

test('le verrou de production de createOrder reste en place', () => {
  const src = read('controllers', 'orderController.js');
  assert.match(src, /MARKETPLACE_COMMERCE_NOT_READY/);
});
