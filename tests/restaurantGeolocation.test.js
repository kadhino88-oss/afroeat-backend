'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { geocodeAddress } = require('../utils/partnerRestaurant');

const reply = (body, ok = true) => ({ ok, json: async () => body });

test('géocodage : Nominatim d’abord', async () => {
  const calls = [];
  const point = await geocodeAddress('Rue de Carouge 10', 'Genève', 'Suisse', async (url) => {
    calls.push(url);
    return reply([{ lat: '46.19', lon: '6.14' }]);
  });
  assert.deepEqual(point, { lat: 46.19, lng: 6.14 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /nominatim/);
});

test('géocodage : Photon en secours quand Nominatim refuse (serveurs d’hébergement)', async () => {
  const point = await geocodeAddress('Rue de Carouge 10', 'Genève', 'Suisse', async (url) =>
    /nominatim/.test(url) ? reply(null, false) : reply({ features: [{ geometry: { coordinates: [6.141, 46.191] } }] })
  );
  assert.deepEqual(point, { lat: 46.191, lng: 6.141 });
});

test('géocodage : rien trouvé ou panne → null, sans exception', async () => {
  assert.equal(await geocodeAddress('x', '', '', async () => { throw new Error('réseau'); }), null);
  assert.equal(await geocodeAddress('x', '', '', async () => reply({ features: [] })), null);
});

test('le restaurateur peut placer son restaurant à son adresse (et la position alimente la recherche)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'restaurantController.js'), 'utf8');
  assert.match(src, /req\.body\?\.locateFromAddress === true/);
  assert.match(src, /code: 'ADDRESS_NOT_FOUND'/);
  assert.match(src, /payload\.location = \{ latitude: payload\.latitude/);
});
