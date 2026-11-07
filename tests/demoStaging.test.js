'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const {
  DEMO_PREFIX,
  DEMO_OWNER,
  DEMO_BUSINESSES,
  isStagingDatabaseName,
  assertStagingDatabase,
} = require('../data/demoStaging');

const ownerId = new mongoose.Types.ObjectId();

test('garde-fou : seules les bases *_staging sont acceptées', () => {
  assert.equal(isStagingDatabaseName('afroeat_staging'), true);
  for (const name of ['afroeat', 'afroeat_prod', 'production', 'staging_afroeat', '', undefined, null]) {
    assert.equal(isStagingDatabaseName(name), false, String(name));
    assert.throws(() => assertStagingDatabase(name), /Refus/);
  }
  assert.doesNotThrow(() => assertStagingDatabase('afroeat_staging'));
});

test('le propriétaire de démo est valide et non joignable', () => {
  const user = new User({ ...DEMO_OWNER, password: 'x'.repeat(40), accountStatus: 'active' });
  assert.equal(user.validateSync(), undefined);
  assert.match(DEMO_OWNER.email, /\.invalid$/);
});

test('chaque commerce et chaque article de démo passent la validation du modèle', () => {
  assert.ok(DEMO_BUSINESSES.length >= 3);
  for (const business of DEMO_BUSINESSES) {
    const restaurant = new Restaurant({ ...business.restaurant, owner: ownerId });
    assert.equal(restaurant.validateSync(), undefined, business.restaurant.name);

    assert.ok(business.items.length >= 2);
    for (const item of business.items) {
      const dish = new MenuItem({ ...item, restaurant: restaurant._id });
      assert.equal(dish.validateSync(), undefined, `${business.restaurant.name} / ${item.name}`);
    }
  }
});

test('tout est étiqueté démo et aucune donnée ne paraît réelle', () => {
  for (const business of DEMO_BUSINESSES) {
    assert.ok(business.restaurant.name.startsWith(DEMO_PREFIX));
    assert.match(business.restaurant.description, /démonstration/i);
    assert.match(business.restaurant.phone, /^\+41 00 000/);
    assert.equal(business.restaurant.city, 'Genève');
    assert.equal(business.restaurant.currency, 'CHF');
    for (const item of business.items) assert.match(item.description, /\(démo\)/);
  }
});

test('les types de commerce couvrent restaurant, épicerie et boissons', () => {
  const types = new Set(DEMO_BUSINESSES.map((business) => business.restaurant.businessType));
  for (const type of ['restaurant', 'grocery', 'drinks']) assert.ok(types.has(type), type);
});

test('noms uniques (le chargement est idempotent par nom et par propriétaire)', () => {
  const names = DEMO_BUSINESSES.map((business) => business.restaurant.name);
  assert.equal(new Set(names).size, names.length);
});
