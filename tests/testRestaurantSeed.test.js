'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const mongoose = require('mongoose');
const { buildOwner, buildRestaurant, buildMenuItems } = require('../utils/testRestaurantSeed');

test('données de test : propriétaire, restaurant et plats passent la validation des modèles', () => {
  const owner = new User(buildOwner('Test-Passw0rd!x'));
  assert.equal(owner.validateSync(), undefined, String(owner.validateSync()));
  const restaurant = new Restaurant(buildRestaurant(new mongoose.Types.ObjectId()));
  assert.equal(restaurant.validateSync(), undefined, String(restaurant.validateSync()));
  for (const item of buildMenuItems(new mongoose.Types.ObjectId())) {
    const doc = new MenuItem(item);
    assert.equal(doc.validateSync(), undefined, `${item.name}: ${doc.validateSync()}`);
  }
});

test('données de test : clairement marquées TEST, sans image', () => {
  const restaurant = buildRestaurant(new mongoose.Types.ObjectId());
  assert.match(restaurant.name, /TEST/);
  for (const item of buildMenuItems(new mongoose.Types.ObjectId())) {
    assert.match(item.name, /TEST/);
    assert.equal(item.image, undefined);
  }
});
