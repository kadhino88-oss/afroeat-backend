'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendMail } = require('../utils/mailer');

const withEnv = async (fn) => {
  const before = { k: process.env.RESEND_API_KEY, f: process.env.MAIL_FROM };
  process.env.RESEND_API_KEY = 're_test';
  process.env.MAIL_FROM = 'AfroEat <no-reply@example.test>';
  try { await fn(); } finally {
    if (before.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = before.k;
    if (before.f === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = before.f;
  }
};

test('un refus du service d\'envoi remonte le motif pour le diagnostic', async () => {
  await withEnv(async () => {
    const res = await sendMail({ to: 'a@b.c', subject: 's', text: 't' }, async () => ({
      ok: false, status: 403, json: async () => ({ message: 'The example.test domain is not verified.' }),
    }));
    assert.equal(res.sent, false);
    assert.match(res.reason, /^HTTP_403: The example\.test domain is not verified\./);
  });
});

test('sans corps lisible, le motif reste le code HTTP', async () => {
  await withEnv(async () => {
    const res = await sendMail({ to: 'a@b.c', subject: 's', text: 't' }, async () => ({
      ok: false, status: 500, json: async () => { throw new Error('x'); },
    }));
    assert.equal(res.reason, 'HTTP_500');
  });
});
