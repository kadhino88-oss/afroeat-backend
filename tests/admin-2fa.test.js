const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET = 'x'.repeat(48);
process.env.DOCUMENT_ENCRYPTION_KEY = 'ab'.repeat(32);

const totp = require('../utils/totp');
const { encryptDocument } = require('../utils/documentCrypto');

// Faux modèle User en mémoire : le contrôleur n'a besoin que de findById / save / updateOne.
const userPath = require.resolve('../models/User');
let current = null;
require.cache[userPath] = {
  id: userPath, filename: userPath, loaded: true,
  exports: {
    findById: () => ({ select: async () => current }),
    updateOne: async () => ({}),
  },
};
const ctrl = require('../controllers/twoFactorController');

const makeUser = (secret, backups = []) => ({
  _id: 'u1', role: 'admin',
  twoFactor: { enabled: true, secret: encryptDocument(Buffer.from(secret)), lastStep: 0, backupCodeHashes: backups.map(totp.hashBackupCode) },
  save: async function () { return this; },
});
const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('vecteur RFC 6238 : code attendu à t=59 s', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.hotp(secret, 1), '287082');
  assert.equal(totp.verifyTotp(secret, '287082', { now: 59000 }), 1);
  assert.equal(totp.verifyTotp(secret, '000000', { now: 59000 }), null);
  assert.equal(totp.verifyTotp(secret, '12345', { now: 59000 }), null);
});

test('un code déjà utilisé est refusé (anti-rejeu)', () => {
  const secret = totp.generateSecret();
  const now = Date.now();
  const code = totp.hotp(secret, totp.currentStep(now));
  const step = totp.verifyTotp(secret, code, { now });
  assert.ok(step);
  assert.equal(totp.verifyTotp(secret, code, { now, minStep: step }), null);
});

test('connexion en deux étapes : bon code accepté, rejeu et mauvais code refusés', async () => {
  const secret = totp.generateSecret();
  current = makeUser(secret);
  const challengeToken = ctrl.signChallenge(current);
  const login = ctrl.completeLogin(() => 'SESSION', () => ({ id: 'u1' }));

  const good = res();
  await login({ body: { challengeToken, code: totp.hotp(secret, totp.currentStep()) } }, good);
  assert.equal(good.body.token, 'SESSION');

  const replay = res();
  await login({ body: { challengeToken, code: totp.hotp(secret, totp.currentStep()) } }, replay);
  assert.equal(replay.code, 401);

  const bad = res();
  await login({ body: { challengeToken, code: '000000' } }, bad);
  assert.equal(bad.code, 401);
});

test('un jeton de défi falsifié ou expiré est refusé', async () => {
  current = makeUser(totp.generateSecret());
  const r = res();
  await ctrl.completeLogin(() => 'S', () => ({}))({ body: { challengeToken: 'nimporte.quoi', code: '123456' } }, r);
  assert.equal(r.code, 401);
});

test('un code de secours ne sert qu’une fois', async () => {
  const secret = totp.generateSecret();
  current = makeUser(secret, ['abcde-12345']);
  const login = ctrl.completeLogin(() => 'SESSION', () => ({}));
  const t = ctrl.signChallenge(current);
  const first = res();
  await login({ body: { challengeToken: t, code: 'abcde-12345' } }, first);
  assert.equal(first.body.token, 'SESSION');
  const second = res();
  await login({ body: { challengeToken: t, code: 'abcde-12345' } }, second);
  assert.equal(second.code, 401);
});

test('un jeton de session ordinaire ne peut pas servir de défi 2FA', async () => {
  current = makeUser(totp.generateSecret());
  const jwt = require('jsonwebtoken');
  const sessionLike = jwt.sign({ id: 'u1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const r = res();
  await ctrl.completeLogin(() => 'S', () => ({}))({ body: { challengeToken: sessionLike, code: '123456' } }, r);
  assert.equal(r.code, 401);
});

test("l'URL otpauth est compatible avec les applications d'authentification", () => {
  const url = totp.otpauthUrl('admin@afroeat.app', 'ABCDEF234567');
  assert.match(url, /^otpauth:\/\/totp\/AFROEAT%3Aadmin%40afroeat\.app\?secret=ABCDEF234567&issuer=AFROEAT/);
});
