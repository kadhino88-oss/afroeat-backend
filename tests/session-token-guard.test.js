'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'x'.repeat(48);

const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const userController = require('../controllers/userController');
const twoFactor = require('../controllers/twoFactorController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const reqWith = (token) => ({ headers: { authorization: `Bearer ${token}` } });
const stubUser = (user) => { User.findById = () => ({ select: async () => user }); };
const run = async (token) => { const r = res(); let nexted = false; await protect(reqWith(token), r, () => { nexted = true; }); return { r, nexted }; };

const admin = { _id: 'a1', role: 'admin', accountStatus: 'active', passwordChangedAt: null };

test('un jeton de défi 2FA est refusé par protect (401)', async () => {
  stubUser(admin);
  const challenge = twoFactor.signChallenge(admin);
  const { r, nexted } = await run(challenge);
  assert.equal(r.statusCode, 401);
  assert.equal(nexted, false);
});

test('tout jeton portant `purpose` est refusé, un jeton de session normal est accepté', async () => {
  stubUser(admin);
  const odd = jwt.sign({ id: 'a1', purpose: 'whatever' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  assert.equal((await run(odd)).r.statusCode, 401);
  const session = userController.generateToken(admin);
  const ok = await run(session);
  assert.equal(ok.nexted, true);
});

test('le flux /login/2fa accepte toujours le jeton de défi', async () => {
  const stored = { _id: 'a1', role: 'admin', twoFactor: { enabled: false } };
  stubUser(stored);
  const challenge = twoFactor.signChallenge(admin);
  const r = res();
  await twoFactor.completeLogin(() => 'SESSION', () => ({ id: 'a1' }))({ body: { challengeToken: challenge, code: '000000' } }, r);
  // Le jeton est reconnu (pas de « Jeton invalide ») ; c'est le code/2FA qui est évalué ensuite.
  assert.notEqual(r.body?.message, 'Jeton invalide.');
});

test('les routes admin/vérification utilisent le protect d\'authMiddleware (contrôle passwordChangedAt)', async () => {
  for (const f of ['adminRoutes.js', 'adminOpsRoutes.js', 'verificationRoutes.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.match(src, /const \{ protect \} = require\('\.\.\/middleware\/authMiddleware'\)/, f);
  }
  assert.equal(userController.protect, undefined);
});

test('jeton émis avant un changement de mot de passe refusé (route admin)', async () => {
  const changedAt = new Date();
  stubUser({ ...admin, passwordChangedAt: changedAt });
  const old = jwt.sign({ id: 'a1', role: 'admin', iat: Math.floor(changedAt.getTime() / 1000) - 120 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const { r, nexted } = await run(old);
  assert.equal(r.statusCode, 401);
  assert.equal(nexted, false);
});
