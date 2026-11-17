const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScheduledFor, isDueForDispatch } = require('../utils/scheduling');

const now = Date.parse('2026-12-02T10:00:00Z'); // mercredi 11:00 à Genève
const restaurant = { openingHours: [{ day: 'wed', open: '11:00', close: '22:00', isClosed: false }] };

test('commande programmée : délais et horaires', () => {
  assert.deepEqual(parseScheduledFor(undefined, restaurant, now), { ok: true, date: null });
  assert.equal(parseScheduledFor('n’importe quoi', restaurant, now).code, 'INVALID_SCHEDULE');
  assert.equal(parseScheduledFor(new Date(now + 10 * 60000).toISOString(), restaurant, now).code, 'SCHEDULE_TOO_SOON');
  assert.equal(parseScheduledFor(new Date(now + 9 * 86400000).toISOString(), restaurant, now).code, 'SCHEDULE_TOO_FAR');
  assert.equal(parseScheduledFor('2026-12-02T18:00:00Z', restaurant, now).ok, true); // 19:00 locale
  assert.equal(parseScheduledFor('2026-12-02T22:30:00Z', restaurant, now).code, 'SCHEDULE_OUTSIDE_HOURS'); // 23:30
});

test('proposée aux livreurs 45 min avant l’heure', () => {
  assert.equal(isDueForDispatch({ scheduledFor: null }, now), true);
  assert.equal(isDueForDispatch({ scheduledFor: new Date(now + 30 * 60000) }, now), true);
  assert.equal(isDueForDispatch({ scheduledFor: new Date(now + 3 * 3600000) }, now), false);
});
