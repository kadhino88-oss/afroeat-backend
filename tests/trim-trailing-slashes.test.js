'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { trimTrailingSlashes } = require('../utils/trimTrailingSlashes');
const { isAdminOriginAllowed } = require('../utils/adminOrigin');

test('trimTrailingSlashes removes only trailing slashes', () => {
  assert.equal(trimTrailingSlashes('https://a.example///'), 'https://a.example');
  assert.equal(trimTrailingSlashes('https://a.example/path'), 'https://a.example/path');
  assert.equal(trimTrailingSlashes(''), '');
  assert.equal(trimTrailingSlashes(undefined), '');
  assert.equal(trimTrailingSlashes('///'), '');
});

test('trimTrailingSlashes stays fast on a long hostile Origin header', () => {
  const hostile = `https://x${'/'.repeat(200000)}a`;
  const start = process.hrtime.bigint();
  assert.equal(trimTrailingSlashes(hostile), hostile);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 200, `took ${ms}ms`);
});

test('admin origin check still tolerates trailing slashes and rejects others', () => {
  const env = { ADMIN_WEB_ORIGINS: 'https://admin.example/' };
  assert.equal(isAdminOriginAllowed('https://admin.example//', env), true);
  assert.equal(isAdminOriginAllowed('https://evil.example', env), false);
  assert.equal(isAdminOriginAllowed(undefined, env), false);
  assert.equal(isAdminOriginAllowed('https://anything.example', {}), true);
});
