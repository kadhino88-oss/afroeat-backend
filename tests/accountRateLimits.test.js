'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { createAccountRateLimiters } = require('../middleware/accountRateLimits');

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const post = (server, route, body) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('register : les réponses 201 sont comptées (contrairement à authLimiter)', async () => {
  const limits = createAccountRateLimiters({ isProduction: true, overrides: { registerIp: 3 } });
  const app = express();
  app.use(express.json());
  app.post('/register', ...limits.register, (req, res) => res.status(201).json({ ok: true }));
  const server = await listen(app);
  try {
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await post(server, '/register', { email: `a${i}@x.ch` })).status);
    assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  } finally { server.close(); }
});

test('forgot-password : plafond par e-mail (casse ignorée) même depuis une même IP sous le plafond IP', async () => {
  const limits = createAccountRateLimiters({ isProduction: true, overrides: { forgotIp: 50, forgotEmail: 2 } });
  const app = express();
  app.use(express.json());
  app.post('/forgot', ...limits.forgotPassword, (req, res) => res.status(200).json({ ok: true }));
  const server = await listen(app);
  try {
    assert.equal((await post(server, '/forgot', { email: 'Victim@x.ch' })).status, 200);
    assert.equal((await post(server, '/forgot', { email: 'victim@x.ch ' })).status, 200);
    assert.equal((await post(server, '/forgot', { email: 'VICTIM@x.ch' })).status, 429);
    assert.equal((await post(server, '/forgot', { email: 'other@x.ch' })).status, 200);
  } finally { server.close(); }
});

test('login/2fa : plafond de tentatives par jeton de défi', async () => {
  const limits = createAccountRateLimiters({ isProduction: true, overrides: { twoFactorChallenge: 3 } });
  const app = express();
  app.use(express.json());
  app.post('/2fa', limits.twoFactorChallenge, (req, res) => res.status(401).json({ ok: false }));
  const server = await listen(app);
  try {
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await post(server, '/2fa', { challengeToken: 'tokA', code: String(i) })).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    assert.equal((await post(server, '/2fa', { challengeToken: 'tokB', code: '1' })).status, 401);
  } finally { server.close(); }
});

test('server.js monte les limiteurs dédiés pour register et forgot-password', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /app\.post\('\/api\/users\/register', \.\.\.accountLimits\.register\)/);
  assert.match(src, /app\.post\('\/api\/users\/forgot-password', \.\.\.accountLimits\.forgotPassword\)/);
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'userRoutes.js'), 'utf8');
  assert.match(routes, /\/login\/2fa', loginLimiter, createAccountRateLimiters\(\)\.twoFactorChallenge/);
});
