'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Restaurant = require('../models/Restaurant');

test('existing merchants default to restaurant business type', () => {
  const restaurant = new Restaurant({ name: 'Test AFROEAT', address: '10 Rue Test' });
  assert.equal(restaurant.businessType, 'restaurant');
});

test('merchant business type accepts only supported AFROEAT categories', async () => {
  const supported = ['restaurant', 'grocery', 'drinks', 'shop'];
  assert.deepEqual(Restaurant.schema.path('businessType').enumValues, supported);

  for (const businessType of supported) {
    const restaurant = new Restaurant({
      name: 'Test AFROEAT',
      address: '10 Rue Test',
      businessType,
    });
    const error = restaurant.validateSync();
    assert.ok(!error || !error.errors.businessType, `unexpected validation error for ${businessType}`);
  }

  const invalid = new Restaurant({
    name: 'Test AFROEAT',
    address: '10 Rue Test',
    businessType: 'unknown',
  });
  assert.ok(invalid.validateSync().errors.businessType);
});

test('restaurant create and update controllers accept validated business type', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'restaurantController.js'),
    'utf8',
  );
  assert.match(controller, /payload\.businessType\s*=\s*normalizeBusinessType\(reqBody\.businessType\)/);
  assert.match(controller, /reqBody\.businessType\s*!==\s*undefined/);
});

test('restaurant catalog filters support the four merchant business types', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'restaurantController.js'),
    'utf8',
  );
  assert.ok(controller.includes('const businessType = normalizeText(query.businessType)'));
  assert.ok(controller.includes('if (businessType) filters.businessType = normalizeBusinessType(businessType)'));
  assert.ok(controller.includes('businessType: normalizeText(req.query.businessType)'));
});
