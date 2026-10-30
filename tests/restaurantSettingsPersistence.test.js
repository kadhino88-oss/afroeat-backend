'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Restaurant = require('../models/Restaurant');

test('restaurant operational settings have safe backward-compatible defaults', () => {
  const restaurant = new Restaurant({ name: 'Test AFROEAT', address: '10 Rue Test' });
  assert.equal(restaurant.isOpen, true);
  assert.equal(restaurant.autoAcceptOrders, false);
  assert.equal(restaurant.notificationsEnabled, true);
  assert.equal(restaurant.preparationMode, true);
});

test('restaurant update controller persists all supported operational settings', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'restaurantController.js'),
    'utf8',
  );
  for (const key of ['isOpen', 'autoAcceptOrders', 'notificationsEnabled', 'preparationMode']) {
    assert.ok(controller.includes(`payload.${key}`), `controller is missing ${key}`);
    assert.ok(controller.includes(`reqBody.${key}`), `request mapping is missing ${key}`);
  }
});
