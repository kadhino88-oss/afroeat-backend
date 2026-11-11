'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOpeningHours, isWithinOpeningHours, isRestaurantOpenNow } = require('../utils/openingHours');

// 10 nov. 2026 = mardi. Genève = UTC+1 en novembre.
const at = (iso) => new Date(iso);
const week = [
  { day: 'mon', isClosed: true },
  { day: 'tue', open: '11:00', close: '22:00' },
  { day: 'fri', open: '18:00', close: '02:00' },
];
const hours = normalizeOpeningHours(week).value;

test('normalise et ordonne les jours', () => {
  assert.deepEqual(hours.map((h) => h.day), ['mon', 'tue', 'fri']);
  assert.equal(hours[0].isClosed, true);
});

test('refuse les horaires invalides', () => {
  assert.ok(normalizeOpeningHours('x').error);
  assert.ok(normalizeOpeningHours([{ day: 'lun', open: '10:00', close: '12:00' }]).error);
  assert.ok(normalizeOpeningHours([{ day: 'mon', open: '25:00', close: '12:00' }]).error);
  assert.ok(normalizeOpeningHours([{ day: 'mon', open: '10:00', close: '10:00' }]).error);
  assert.ok(normalizeOpeningHours([{ day: 'mon', open: '10:00', close: '12:00' }, { day: 'mon', open: '13:00', close: '14:00' }]).error);
  assert.deepEqual(normalizeOpeningHours([]).value, []);
});

test('ouvert / fermé selon l’heure de Genève', () => {
  assert.equal(isWithinOpeningHours(hours, at('2026-11-10T12:00:00+01:00')), true); // mardi 12h
  assert.equal(isWithinOpeningHours(hours, at('2026-11-10T22:30:00+01:00')), false); // mardi 22h30
  assert.equal(isWithinOpeningHours(hours, at('2026-11-09T12:00:00+01:00')), false); // lundi fermé
  assert.equal(isWithinOpeningHours(hours, at('2026-11-11T12:00:00+01:00')), false); // mercredi sans créneau
});

test('un créneau qui passe minuit couvre le début de la nuit suivante', () => {
  assert.equal(isWithinOpeningHours(hours, at('2026-11-13T23:00:00+01:00')), true); // vendredi 23h
  assert.equal(isWithinOpeningHours(hours, at('2026-11-14T01:00:00+01:00')), true); // samedi 1h
  assert.equal(isWithinOpeningHours(hours, at('2026-11-14T03:00:00+01:00')), false); // samedi 3h
});

test('sans horaires, seul le bouton ouvert/fermé compte', () => {
  assert.equal(isRestaurantOpenNow({ isOpen: true, openingHours: [] }), true);
  assert.equal(isRestaurantOpenNow({ isOpen: false, openingHours: [] }), false);
  assert.equal(isRestaurantOpenNow({ isOpen: true, openingHours: hours }, at('2026-11-09T12:00:00+01:00')), false);
});
