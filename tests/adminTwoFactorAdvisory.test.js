'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(48);
delete process.env.ADMIN_WEB_ORIGINS;

const User = require('../models/User');
const { loginUser } = require('../controllers/userController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const stubUser = (props) => {
  User.findOne = () => ({ select: async () => ({
    _id: 'u1', email: 'a@x.ch', name: 'A', role: 'admin', accountStatus: 'active',
    matchPassword: async () => true, ...props,
  }) });
};
const login = async (role) => { const r = res(); await loginUser({ body: { email: 'a@x.ch', password: 'pw', role }, headers: {} }, r); return r; };

test('admin sans 2FA : connexion non bloquée, indicateur twoFactorRequired/mustEnableTwoFactor', async () => {
  stubUser({ twoFactor: { enabled: false } });
  const r = await login('admin');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.twoFactorRequired, true);
  assert.equal(r.body.mustEnableTwoFactor, true);
});

test('admin avec 2FA : défi demandé, pas de jeton de session ni d\'indicateur', async () => {
  stubUser({ twoFactor: { enabled: true } });
  const r = await login('admin');
  assert.equal(r.body.requires2FA, true);
  assert.equal(r.body.token, undefined);
  assert.equal(r.body.mustEnableTwoFactor, undefined);
});

test('un client ne reçoit pas l\'indicateur 2FA', async () => {
  stubUser({ role: 'client' });
  const r = await login('client');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.mustEnableTwoFactor, undefined);
});
