'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const User = require('../models/User');
const { changePassword } = require('../controllers/userController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const withUser = (user, fn) => async () => {
  const original = User.findById;
  User.findById = () => ({ select: async () => user });
  try { await fn(); } finally { User.findById = original; }
};
const makeUser = (matches = true) => ({
  password: 'old',
  saved: false,
  matchPassword: async () => matches,
  async save() { this.saved = true; },
});

test('la route est déclarée et limitée en débit', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'routes', 'userRoutes.js'), 'utf8'), /router\.put\('\/me\/password', protect, changePassword\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /app\.use\('\/api\/users\/me\/password', authLimiter\)/);
});

test('refuse un mot de passe faible', async () => {
  const r = res();
  await changePassword({ user: { id: '1' }, body: { currentPassword: 'Ancien1!x', newPassword: 'abc' } }, r);
  assert.equal(r.statusCode, 422);
  assert.equal(r.body.code, 'PASSWORD_WEAK');
});

test('refuse un nouveau mot de passe identique', async () => {
  const r = res();
  await changePassword({ user: { id: '1' }, body: { currentPassword: 'Ancien1!x', newPassword: 'Ancien1!x' } }, r);
  assert.equal(r.body.code, 'PASSWORD_SAME');
});

test('refuse si le mot de passe actuel est faux et ne modifie rien', withUser(makeUser(false), async () => {
  const user = makeUser(false);
  const original = User.findById;
  User.findById = () => ({ select: async () => user });
  const r = res();
  await changePassword({ user: { id: '1' }, body: { currentPassword: 'Faux1!xxx', newPassword: 'Nouveau1!x' } }, r);
  User.findById = original;
  assert.equal(r.statusCode, 401);
  assert.equal(user.saved, false);
}));

test('change le mot de passe quand tout est correct', async () => {
  const user = makeUser(true);
  const original = User.findById;
  User.findById = () => ({ select: async () => user });
  const r = res();
  await changePassword({ user: { id: '1' }, body: { currentPassword: 'Ancien1!x', newPassword: 'Nouveau1!x' } }, r);
  User.findById = original;
  assert.equal(r.body.success, true);
  assert.equal(user.password, 'Nouveau1!x');
  assert.equal(user.saved, true);
});
