const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const envExamplePath = path.join(__dirname, '..', '.env.example');
const envExample = fs.readFileSync(envExamplePath, 'utf8');

function readExampleValue(key) {
  const line = envExample.split(/\r?\n/).find((entry) =>
    entry.trim().startsWith(`${key}=`)
  );

  assert.ok(line, `Missing ${key} in .env.example`);
  return line.slice(line.indexOf('=') + 1).trim();
}

test('marketplace payouts remain disabled in the example environment', () => {
  assert.equal(readExampleValue('STRIPE_CONNECT_PAYOUTS_ENABLED'), 'false');
});

test('Stripe secrets are blank in the example environment', () => {
  assert.equal(readExampleValue('STRIPE_SECRET_KEY'), '');
  assert.equal(readExampleValue('STRIPE_WEBHOOK_SECRET'), '');
});

test('marketplace rates are not pre-approved by a sample configuration', () => {
  assert.equal(readExampleValue('MARKETPLACE_RATES_JSON'), '');
});

test('example environment uses a non-production API callback URL', () => {
  assert.equal(readExampleValue('PUBLIC_API_URL'), 'https://api.example.invalid');
});

test('example JWT secret is clearly a placeholder and cannot be mistaken for a real secret', () => {
  const secret = readExampleValue('JWT_SECRET');
  assert.match(secret, /^REPLACE_WITH_/);
  assert.ok(secret.length >= 32);
});
