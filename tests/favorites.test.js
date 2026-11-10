'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { listFavorites, addFavorite, removeFavorite } = require('../controllers/favoriteController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const me = { _id: new mongoose.Types.ObjectId() };

test('routes favoris déclarées pour les clients (l’appli recevait une 404)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'userRoutes.js'), 'utf8');
  assert.match(src, /router\.get\('\/me\/favorites', protect, allowRoles\('client'\), listFavorites\)/);
  assert.match(src, /router\.put\('\/me\/favorites\/:id'/);
  assert.match(src, /router\.delete\('\/me\/favorites\/:id'/);
});

test('le modèle client accepte une liste de favoris', () => {
  const user = new User({ name: 'A', email: 'a@b.ch', password: 'Motdepasse1!', role: 'client', favoriteRestaurants: [new mongoose.Types.ObjectId()] });
  assert.equal(user.favoriteRestaurants.length, 1);
});

test('ajout, liste et retrait', async () => {
  const rid = new mongoose.Types.ObjectId();
  let stored = [];
  User.findById = () => ({ select: () => ({ lean: async () => ({ favoriteRestaurants: stored }), then: undefined }) });
  User.findById = (id) => ({
    select: () => {
      const doc = { favoriteRestaurants: stored };
      return Object.assign(Promise.resolve(doc), { lean: async () => doc });
    },
  });
  User.updateOne = async (_q, update) => {
    if (update.$addToSet) stored = [...stored, update.$addToSet.favoriteRestaurants];
    if (update.$pull) stored = stored.filter((v) => String(v) !== String(update.$pull.favoriteRestaurants));
    return {};
  };
  Restaurant.exists = async () => true;
  Restaurant.find = () => ({ select: () => ({ lean: async () => stored.map((id) => ({ _id: id, name: 'Chez Test' })) }) });

  let r = res();
  await addFavorite({ user: me, params: { id: String(rid) } }, r);
  assert.equal(r.statusCode, 200);
  r = res();
  await addFavorite({ user: me, params: { id: String(rid) } }, r);
  assert.equal(stored.length, 1, 'pas de doublon');
  r = res();
  await listFavorites({ user: me }, r);
  assert.equal(r.body.restaurants.length, 1);
  r = res();
  await removeFavorite({ user: me, params: { id: String(rid) } }, r);
  assert.equal(stored.length, 0);
  r = res();
  await addFavorite({ user: me, params: { id: 'nope' } }, r);
  assert.equal(r.statusCode, 400);
});
