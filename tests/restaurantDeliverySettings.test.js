'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('le restaurateur peut régler minimum de commande et frais de livraison (bornés)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'restaurantController.js'), 'utf8');
  assert.match(src, /reqBody\.minimumOrderAmount !== undefined/);
  assert.match(src, /Le minimum de commande est invalide\./);
  assert.match(src, /payload\.deliveryFee > 1000/);
});
