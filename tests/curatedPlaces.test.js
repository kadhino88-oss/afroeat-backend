'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { slugify, makeKey, validateEntry, buildQuery, toPlaceDoc, sharesDistinctiveName } = require('../utils/curatedPlaces');

const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'curated-african-places.json'), 'utf8'));

test('liste saisie : toutes les entrées sont valides, avec une source, et les clés sont uniques', () => {
  const keys = new Set();
  for (const entry of entries) {
    assert.equal(validateEntry(entry), null, entry.name);
    assert.match(entry.source, /^https?:\/\//, entry.name);
    keys.add(makeKey(entry));
  }
  assert.equal(keys.size, entries.length);
});

test('slugify / clé : accents et apostrophes neutralisés', () => {
  assert.equal(slugify("La Table d'Ebène"), 'la-table-d-ebene');
  assert.equal(makeKey({ name: 'Yamba', city: 'Genève' }), 'curated/yamba-geneve');
});

test('requête de géocodage et document Place (africain, point [lng, lat])', () => {
  const entry = entries.find((e) => e.name === 'Yamba');
  assert.equal(buildQuery(entry), 'Rue des Deux-Ponts 2, 1205 Genève, Suisse');
  const doc = toPlaceDoc(entry, { lat: 46.2, lng: 6.14 });
  assert.equal(doc.isAfrican, true);
  assert.deepEqual(doc.location.coordinates, [6.14, 46.2]);
  assert.equal(doc.kind, 'restaurant');
});

test('entrée invalide refusée', () => {
  assert.match(validateEntry({ name: 'X', kind: 'bar', address: 'a', city: 'b' }), /type invalide/);
  assert.match(validateEntry({ name: '', kind: 'grocery', address: 'a', city: 'b' }), /nom manquant/);
});

test('doublons OSM : mêmes commerces reconnus, commerces différents non confondus', () => {
  assert.equal(sharesDistinctiveName("La Gazelle d'Or (Restaurant Erythréen)", "Gazelle d'Or African Village"), true);
  assert.equal(sharesDistinctiveName('Le Palmarin', 'Le Palmarin African Food'), true);
  assert.equal(sharesDistinctiveName('Nyala Barka', 'Nyala Barka'), true);
  assert.equal(sharesDistinctiveName('Le 224', 'Le 224'), true);
  // Deux commerces voisins sans lien : pas de fusion.
  assert.equal(sharesDistinctiveName('Yamba', 'Mosaïque'), false);
  assert.equal(sharesDistinctiveName('Best African Food', 'T&A African Food'), false);
  assert.equal(sharesDistinctiveName('African Food', 'Restaurant Africain'), false);
});
