const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const MenuItem = require('../models/MenuItem');
const { buildUpdatePayload, buildCreatePayload, getOpeningReadiness } = require('../controllers/restaurantController');
const { normalizeCountry, currencyFor } = require('../utils/partnerRestaurant');
const { validateApplication } = require('../utils/partnerApplication');

test('pays : codes et noms usuels ramenés à France / Suisse, devise cohérente', () => {
  for (const v of ['FR', 'fr', 'France', ' france ']) assert.equal(normalizeCountry(v), 'France');
  for (const v of ['CH', 'Suisse', 'Switzerland']) assert.equal(normalizeCountry(v), 'Suisse');
  assert.equal(currencyFor('FR'), 'EUR');
  assert.equal(currencyFor('CH'), 'CHF');
  assert.equal(currencyFor(''), 'CHF');
});

test('candidature : le pays est normalisé', () => {
  const data = validateApplication({
    businessName: 'Chez Test', businessType: 'restaurant', contactName: 'Jean Test', email: 'jean@example.com',
    phone: '+33 6 12 34 56 78', address: '1 rue du Test', city: 'Annemasse', country: 'FR', consent: true,
  });
  assert.equal(data.country, 'France');
});

test('un restaurateur ne peut changer ni pays, ni devise, ni visibilité ; l’admin le peut', async () => {
  const body = { country: 'France', currency: 'eur', isActive: true, deliveryFee: 2, deliveryRadiusKm: 6 };
  const owner = await buildUpdatePayload(body, { role: 'restaurant' });
  assert.equal(owner.country, undefined);
  assert.equal(owner.currency, undefined);
  assert.equal(owner.isActive, undefined);
  assert.equal(owner.deliveryFee, 2);
  assert.equal(owner.deliveryRadiusKm, 6);
  const admin = await buildUpdatePayload(body, { role: 'admin' });
  assert.equal(admin.country, 'France');
  assert.equal(admin.currency, 'EUR');
  assert.equal(admin.isActive, true);
});

test('rayon de livraison : borné, vidable', async () => {
  await assert.rejects(() => buildUpdatePayload({ deliveryRadiusKm: 0 }, { role: 'restaurant' }), /rayon/i);
  await assert.rejects(() => buildUpdatePayload({ deliveryRadiusKm: 500 }, { role: 'restaurant' }), /rayon/i);
  assert.equal((await buildUpdatePayload({ deliveryRadiusKm: null }, { role: 'restaurant' })).deliveryRadiusKm, null);
});

test('une fiche créée par un non-admin est masquée ; l’admin peut la publier', async () => {
  const User = require('../models/User');
  const original = User.findById;
  const ownerId = new mongoose.Types.ObjectId();
  User.findById = () => ({ select: async () => ({ _id: ownerId, role: 'restaurant' }) });
  try {
    const base = { owner: String(ownerId), name: 'R', address: '1 rue A', isActive: true };
    const byOwner = await buildCreatePayload(base, { role: 'restaurant', _id: ownerId });
    assert.equal(byOwner.isActive, false);
    const byAdmin = await buildCreatePayload(base, { role: 'admin' });
    assert.equal(byAdmin.isActive, true);
  } finally {
    User.findById = original;
  }
});

test('ouverture : position et au moins un plat disponible exigés', async () => {
  const original = MenuItem.countDocuments;
  try {
    MenuItem.countDocuments = async () => 0;
    const none = await getOpeningReadiness({ _id: 'r1' }, {});
    assert.deepEqual(none.reasons, ['NO_POSITION', 'NO_MENU_ITEM']);
    assert.equal(none.ready, false);
    MenuItem.countDocuments = async () => 3;
    const ok = await getOpeningReadiness({ _id: 'r1', latitude: 46.19, longitude: 6.23 }, {});
    assert.equal(ok.ready, true);
    const zero = await getOpeningReadiness({ _id: 'r1', latitude: 0, longitude: 0 }, {});
    assert.deepEqual(zero.reasons, ['NO_POSITION']);
    const viaPayload = await getOpeningReadiness({ _id: 'r1' }, { latitude: 46.2, longitude: 6.2 });
    assert.equal(viaPayload.ready, true);
  } finally {
    MenuItem.countDocuments = original;
  }
});
