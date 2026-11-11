'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'deliveryController.js'), 'utf8');

test('les gains du livreur indiquent la devise des commandes (CHF/EUR)', () => {
  assert.match(src, /currency: String\(deliveredOrders\[0\]\?\.currency \|\| 'EUR'\)\.toUpperCase\(\)/);
  assert.match(src, /currency: String\(order\.currency \|\| 'EUR'\)\.toUpperCase\(\)/);
  assert.match(src, /currency: items\[0\]\?\.currency \|\| 'EUR'/);
});
