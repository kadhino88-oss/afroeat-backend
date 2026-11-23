'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(48);
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:1/afroeat_unit';
delete process.env.HEALTH_DETAILS_TOKEN;

const app = require('../server');
const Restaurant = require('../models/Restaurant');
const { publicBase } = require('../controllers/imageController');
const { buildUpdatePayload } = require('../controllers/restaurantController');
const User = require('../models/User');

const withServer = async (fn) => {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
};

test('GET / ne révèle pas l\'environnement', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/`)).json();
    assert.equal('environment' in body, false);
    assert.equal(body.success, true);
  });
});

test('GET /health garde la readiness sans nom ni hôte de base', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.ok([200, 503].includes(response.status));
    assert.equal(typeof body.database.connected, 'boolean');
    assert.equal(typeof body.database.stateLabel, 'string');
    assert.equal('name' in body.database, false);
    assert.equal('host' in body.database, false);
  });
});

test('GET /health expose le nom de base seulement avec le bon jeton dédié', async () => {
  process.env.HEALTH_DETAILS_TOKEN = 'health-token-0123456789';
  try {
    await withServer(async (base) => {
      const bad = await (await fetch(`${base}/health`, { headers: { 'x-health-token': 'health-token-wrong-000' } })).json();
      assert.equal('name' in bad.database, false);
      const good = await (await fetch(`${base}/health`, { headers: { 'x-health-token': 'health-token-0123456789' } })).json();
      assert.equal('name' in good.database, true);
    });
  } finally { delete process.env.HEALTH_DETAILS_TOKEN; }
});

test('URL d\'image : PUBLIC_API_URL est préféré à l\'en-tête Host', () => {
  const req = { headers: { 'x-forwarded-proto': 'https' }, protocol: 'https', get: () => 'evil.example' };
  process.env.PUBLIC_API_URL = 'https://api.afroeat.example/';
  try {
    assert.equal(publicBase(req), 'https://api.afroeat.example');
    delete process.env.PUBLIC_API_URL;
    assert.equal(publicBase(req), 'https://evil.example');
    process.env.PUBLIC_API_URL = 'javascript:alert(1)';
    assert.equal(publicBase(req), 'https://evil.example');
  } finally { delete process.env.PUBLIC_API_URL; }
});

test('PUT /restaurants/:id : `owner` ignoré pour un restaurant, pris en compte pour un admin', async () => {
  const target = '64b000000000000000000009';
  User.findById = () => ({ select: async () => ({ _id: target, role: 'restaurant' }) });
  const asRestaurant = await buildUpdatePayload({ name: 'X', owner: target }, { role: 'restaurant', _id: 'me' });
  assert.equal('owner' in asRestaurant, false);
  assert.equal(asRestaurant.name, 'X');
  const asAdmin = await buildUpdatePayload({ owner: target }, { role: 'admin', _id: 'adm' });
  assert.equal(String(asAdmin.owner), target);
  void Restaurant;
});
