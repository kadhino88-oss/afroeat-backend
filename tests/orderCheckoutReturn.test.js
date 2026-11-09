'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.PUBLIC_WEB_URL = 'https://afroeat-app.vercel.app';
process.env.CORS_ORIGINS = 'https://afroeat-app.vercel.app';
const { resolveReturnBase } = require('../controllers/savedCardController');

test('retour web : origine autorisée acceptée, origine étrangère ignorée', () => {
  assert.equal(resolveReturnBase('https://afroeat-app.vercel.app'), 'https://afroeat-app.vercel.app');
  assert.equal(resolveReturnBase('https://evil.example'), 'https://afroeat-app.vercel.app');
  assert.equal(resolveReturnBase(undefined), 'https://afroeat-app.vercel.app');
});

test('le paiement de commande utilise un retour https sur le web et le lien profond sur mobile', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'paymentController.js'), 'utf8');
  assert.match(src, /req\.body\?\.platform === 'web' \? resolveReturnBase/);
  assert.match(src, /success_url: `\$\{returnBase\}\/payment\/success/);
  assert.match(src, /cancel_url: `\$\{returnBase\}\/payment\/cancel/);
  assert.match(src, /`\$\{appScheme\}:\/`/);
});
