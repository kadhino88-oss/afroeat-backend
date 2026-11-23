'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(48);

const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { generateToken } = require('../controllers/userController');
const {
  getEnforceDate,
  isAdminTwoFactorEnforced,
  isTwoFactorEnrolmentPath,
} = require('../utils/adminTwoFactorPolicy');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const stubUser = (user) => { User.findById = () => ({ select: async () => user }); };
const call = async (user, url) => {
  stubUser(user);
  const r = res();
  let nexted = false;
  await protect({ headers: { authorization: `Bearer ${generateToken(user)}` }, originalUrl: url }, r, () => { nexted = true; });
  return { r, nexted };
};

const adminNo2fa = { _id: 'a1', role: 'admin', accountStatus: 'active', passwordChangedAt: null, twoFactor: { enabled: false } };
const adminWith2fa = { ...adminNo2fa, twoFactor: { enabled: true } };
const clientUser = { _id: 'c1', role: 'client', accountStatus: 'active', passwordChangedAt: null };

test('policy: sans variable ou variable invalide, rien n\'est imposé', () => {
  assert.equal(getEnforceDate({}), null);
  assert.equal(getEnforceDate({ ADMIN_2FA_ENFORCE_AFTER: 'pas une date' }), null);
  assert.equal(isAdminTwoFactorEnforced({}), false);
  assert.equal(isAdminTwoFactorEnforced({ ADMIN_2FA_ENFORCE_AFTER: 'nope' }), false);
});

test('policy: imposé seulement à partir de la date', () => {
  const env = { ADMIN_2FA_ENFORCE_AFTER: '2026-12-15T00:00:00Z' };
  assert.equal(isAdminTwoFactorEnforced(env, new Date('2026-12-14T23:59:59Z')), false);
  assert.equal(isAdminTwoFactorEnforced(env, new Date('2026-12-15T00:00:00Z')), true);
});

test('policy: seules les routes d\'enrôlement sont exemptées', () => {
  for (const p of ['/api/admin/2fa/status', '/api/admin/2fa/setup', '/api/admin/2fa/enable?x=1', '/api/admin/2fa/setup/']) {
    assert.equal(isTwoFactorEnrolmentPath(p), true, p);
  }
  for (const p of ['/api/admin/2fa/disable', '/api/admin/users', '/api/admin/2fa/setup/../users', '', undefined]) {
    assert.equal(isTwoFactorEnrolmentPath(p), false, String(p));
  }
});

test('protect: admin sans 2FA bloqué après la date, sauf pour s\'enrôler', async () => {
  process.env.ADMIN_2FA_ENFORCE_AFTER = '2000-01-01T00:00:00Z';
  try {
    const blocked = await call(adminNo2fa, '/api/admin/users');
    assert.equal(blocked.r.statusCode, 403);
    assert.equal(blocked.r.body.code, 'ADMIN_2FA_REQUIRED');
    assert.equal(blocked.nexted, false);

    assert.equal((await call(adminNo2fa, '/api/admin/2fa/setup')).nexted, true);
    assert.equal((await call(adminNo2fa, '/api/admin/2fa/enable')).nexted, true);
    assert.equal((await call(adminWith2fa, '/api/admin/users')).nexted, true);
    assert.equal((await call(clientUser, '/api/orders')).nexted, true);
  } finally {
    delete process.env.ADMIN_2FA_ENFORCE_AFTER;
  }
});

test('protect: avant la date (ou sans variable) rien ne change pour un admin sans 2FA', async () => {
  delete process.env.ADMIN_2FA_ENFORCE_AFTER;
  assert.equal((await call(adminNo2fa, '/api/admin/users')).nexted, true);
  process.env.ADMIN_2FA_ENFORCE_AFTER = '2999-01-01T00:00:00Z';
  try {
    assert.equal((await call(adminNo2fa, '/api/admin/users')).nexted, true);
  } finally {
    delete process.env.ADMIN_2FA_ENFORCE_AFTER;
  }
});
