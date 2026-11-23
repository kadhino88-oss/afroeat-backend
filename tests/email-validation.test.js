'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailAddress } = require('../utils/emailValidation');

const legacy = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const legacyTld2 = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

test('matches the previous regex on representative inputs', () => {
  const samples = [
    'a@b.co', 'a@b.c', 'user@example.com', 'first.last@sub.example.org', 'a@b.', 'a@.b', 'a@b', '@b.co',
    'a@@b.co', 'a b@c.de', 'a@b .de', '', 'a@b..c', 'a@b.c.d', 'a@b.cc', 'a@.', 'x@y.z.', 'né@ex.fr', 'a@b.c@d.e',
  ];
  for (const s of samples) {
    assert.equal(isValidEmailAddress(s), legacy.test(s), `default: ${s}`);
    assert.equal(isValidEmailAddress(s, { minLastLabel: 2 }), legacyTld2.test(s), `tld2: ${s}`);
  }
});

test('rejects non-strings and over-long values', () => {
  assert.equal(isValidEmailAddress(undefined), false);
  assert.equal(isValidEmailAddress(null), false);
  assert.equal(isValidEmailAddress(42), false);
  assert.equal(isValidEmailAddress(`a@${'b'.repeat(260)}.com`), false);
});

test('stays fast on the hostile pattern reported by CodeQL', () => {
  const hostile = `!@!.${'!.'.repeat(100000)}`;
  const start = process.hrtime.bigint();
  isValidEmailAddress(hostile);
  isValidEmailAddress(`!@!.${'!.'.repeat(100)}`);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 200, `took ${ms}ms`);
});
