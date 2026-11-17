const test = require('node:test');
const assert = require('node:assert/strict');
const { toEvent, normalizePath, recordError, captureServerErrors } = require('../utils/errorTracker');

test('les identifiants sont retirés du chemin pour regrouper les erreurs', () => {
  assert.equal(normalizePath('/api/orders/6afad86eddb2c7e05658af5b/status?x=1'), '/api/orders/:id/status');
  assert.equal(normalizePath('/api/items/42'), '/api/items/:n');
});

test('deux occurrences de la même erreur ont la même empreinte', () => {
  const a = toEvent({ source: 'api', message: 'Timeout after 3000ms', path: '/api/orders/6afad86eddb2c7e05658af5b' });
  const b = toEvent({ source: 'api', message: 'Timeout after 5000ms', path: '/api/orders/6afad86eddb2c7e05658af5c' });
  const c = toEvent({ source: 'web', message: 'Timeout after 5000ms', path: '/api/orders/x' });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('les champs sont tronqués et la source est bornée', () => {
  const e = toEvent({ source: 'autre', message: 'x'.repeat(2000), stack: 'y'.repeat(9000) });
  assert.equal(e.source, 'api');
  assert.equal(e.message.length, 500);
  assert.equal(e.stack.length, 4000);
});

test('aucune écriture si la base est déconnectée, et jamais d’exception', async () => {
  let called = false;
  const ErrorEvent = { updateOne: async () => { called = true; } };
  assert.equal(await recordError({ message: 'x' }, { ErrorEvent, mongoose: { connection: { readyState: 0 } } }), false);
  assert.equal(called, false);
  const failing = { updateOne: async () => { throw new Error('boom'); } };
  assert.equal(await recordError({ message: 'x' }, { ErrorEvent: failing, mongoose: { connection: { readyState: 1 } } }), false);
});

test('une réponse 5xx est enregistrée avec son message, pas une 4xx', async () => {
  const writes = [];
  const ErrorEvent = { updateOne: async (q, u) => { writes.push(u); } };
  const mongoose = { connection: { readyState: 1 } };
  const run = async (status) => {
    const listeners = {};
    const res = { statusCode: status, locals: {}, json: (b) => b, on: (ev, fn) => { listeners[ev] = fn; } };
    const req = { method: 'GET', originalUrl: '/api/orders', headers: {}, user: { role: 'client' } };
    captureServerErrors({ ErrorEvent, mongoose })(req, res, () => {});
    res.json({ message: 'Erreur serveur.' });
    listeners.finish();
    await new Promise((r) => setImmediate(r));
  };
  await run(404);
  assert.equal(writes.length, 0);
  await run(500);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].$setOnInsert.message, 'Erreur serveur.');
  assert.equal(writes[0].$set.lastUserRole, 'client');
  assert.deepEqual(writes[0].$inc, { count: 1 });
});
