'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { generateResetToken, hashResetToken, isValidResetToken, resetLink } = require('../utils/passwordReset');
const { forgotPassword, resetPassword } = require('../controllers/userController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('jeton : 64 hex, seul le hash est stocké, validité 1 h', () => {
  const { token, tokenHash, expiresAt } = generateResetToken();
  assert.ok(isValidResetToken(token));
  assert.equal(tokenHash, hashResetToken(token));
  assert.notEqual(tokenHash, token);
  const ttl = expiresAt.getTime() - Date.now();
  assert.ok(ttl > 59 * 60 * 1000 && ttl <= 60 * 60 * 1000);
  assert.equal(isValidResetToken('zz'), false);
});

test('le lien pointe vers la page web de réinitialisation', () => {
  process.env.PUBLIC_WEB_URL = 'https://exemple.ch/';
  assert.equal(resetLink('abc'), 'https://exemple.ch/auth/reset-password?token=abc');
});

test('mailer : ignoré sans configuration, aucun appel réseau', async () => {
  delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  let called = false;
  const out = await sendMail({ to: 'a@b.ch', subject: 's', text: 't' }, async () => { called = true; });
  assert.deepEqual(out, { sent: false, reason: 'NOT_CONFIGURED' });
  assert.equal(called, false);
});

test('mailer : envoie via Resend avec la clé en en-tête, sans la journaliser', async () => {
  process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_FROM = 'AfroEat <no-reply@exemple.ch>';
  let seen;
  const out = await sendMail({ to: 'a@b.ch', subject: 's', text: 't' }, async (url, init) => { seen = { url, init }; return { ok: true }; });
  delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
  assert.equal(out.sent, true);
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.equal(seen.init.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(seen.init.body).to, ['a@b.ch']);
});

test('mot de passe oublié : même réponse que le compte existe ou non', async () => {
  const original = User.findOne;
  User.findOne = () => ({ select: async () => null });
  const unknown = res();
  await forgotPassword({ body: { email: 'inconnu@exemple.ch' } }, unknown);
  const invalid = res();
  await forgotPassword({ body: { email: 'pas-un-email' } }, invalid);
  User.findOne = original;
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.body, invalid.body);
  assert.equal(unknown.body.success, true);
});

test('réinitialisation : refuse un jeton mal formé et un mot de passe faible', async () => {
  const bad = res();
  await resetPassword({ body: { token: 'x', password: 'Motdepasse1!' } }, bad);
  assert.equal(bad.statusCode, 400);
  const weak = res();
  await resetPassword({ body: { token: 'a'.repeat(64), password: 'abc' } }, weak);
  assert.equal(weak.statusCode, 422);
});

test('réinitialisation : jeton inconnu ou expiré refusé', async () => {
  const original = User.findOneAndUpdate;
  let filter;
  User.findOneAndUpdate = (f) => { filter = f; return { select: async () => null }; };
  const r = res();
  await resetPassword({ body: { token: 'a'.repeat(64), password: 'Motdepasse1!' } }, r);
  User.findOneAndUpdate = original;
  assert.equal(r.body.code, 'RESET_INVALID');
  assert.ok(filter.passwordResetExpires.$gt instanceof Date);
});

test('réinitialisation : met à jour le mot de passe et consomme le jeton', async () => {
  const origUpdate = User.findOneAndUpdate; const origFind = User.findById;
  const doc = { password: 'old', saved: false, async save() { this.saved = true; } };
  User.findOneAndUpdate = () => ({ select: async () => ({ _id: '1' }) });
  User.findById = () => ({ select: async () => doc });
  const r = res();
  await resetPassword({ body: { token: 'a'.repeat(64), password: 'Motdepasse1!' } }, r);
  User.findOneAndUpdate = origUpdate; User.findById = origFind;
  assert.equal(r.body.success, true);
  assert.equal(doc.password, 'Motdepasse1!');
  assert.equal(doc.saved, true);
});

test('routes déclarées et limitées en débit', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'userRoutes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/forgot-password', forgotPassword\)/);
  assert.match(routes, /router\.post\('\/reset-password', resetPassword\)/);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /'\/api\/users\/forgot-password', authLimiter/);
  assert.match(server, /'\/api\/users\/reset-password', authLimiter/);
});
