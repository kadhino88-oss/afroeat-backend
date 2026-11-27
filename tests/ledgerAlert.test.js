'use strict';

// Alerte e-mail du rapprochement quotidien : mismatch -> un e-mail ; ok -> aucun ; mailer en échec -> réponse
// inchangée ; relance le même jour -> pas de second e-mail ; ALERT_EMAIL absent -> rien. Doubles en mémoire.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPaymentHarness, createRes } = require('./helpers/paymentHarness');
const { installLedgerDouble, patchOrderFind } = require('./helpers/ledgerHarness');

const h = createPaymentHarness();
const double = installLedgerDouble();
const { store, stripe } = h;
const Order = require('../models/Order');
const LedgerReconciliationReport = require('../models/LedgerReconciliationReport');
const mailer = require('../utils/mailer');
const { reconcileDailyCron } = require('../controllers/ledgerController');
const { getYesterdayPeriodUtc } = require('../utils/ledgerDates');
const { buildAlertEmail, resolveRecipient } = require('../utils/ledgerAlert');

patchOrderFind(Order, store);
const CRON_SECRET = crypto.randomBytes(24).toString('hex');
const ALERT = 'alertes@exemple.ch';
const oid = (n) => `64b00000000000000000${String(n).padStart(4, '0')}`;

// Rapports en mémoire (upsert $set du cron + marquage conditionnel de l'alerte).
const reports = new Map();
const keyOf = (f) => `${f.periodStart.getTime()}|${f.periodEnd.getTime()}`;
const behaviour = { failUpdateOne: false, failFindOneAndUpdate: false };
LedgerReconciliationReport.findOneAndUpdate = async (filter, update) => {
  if (behaviour.failFindOneAndUpdate) throw new Error('stockage indisponible');
  const key = keyOf(filter);
  reports.set(key, { ...(reports.get(key) || {}), ...filter, ...update.$set });
  return {};
};
LedgerReconciliationReport.updateOne = async (filter, update) => {
  if (behaviour.failUpdateOne) throw new Error('base indisponible');
  const doc = reports.get(keyOf(filter));
  if (!doc) return { matchedCount: 0, modifiedCount: 0 };
  if (filter.alertedStatus?.$ne !== undefined && doc.alertedStatus === filter.alertedStatus.$ne) return { matchedCount: 0, modifiedCount: 0 };
  if (typeof filter.alertedStatus === 'string' && doc.alertedStatus !== filter.alertedStatus) return { matchedCount: 0, modifiedCount: 0 };
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
  return { matchedCount: 1, modifiedCount: 1 };
};
LedgerReconciliationReport.findOne = (filter) => {
  const doc = reports.get(keyOf(filter)) || null;
  const q = { select() { return q; }, lean() { return q; }, then(resolve) { resolve(doc ? { ...doc } : null); } };
  return q;
};

let listImpl = async () => ({ has_more: false, data: [] });
stripe.balanceTransactions = { list: (params) => listImpl(params) };

let mails = [];
let mailImpl = async () => ({ sent: true });
const realSend = mailer.sendMail;
mailer.sendMail = async (mail) => { mails.push(mail); return mailImpl(mail); };

const cron = async () => {
  const res = createRes();
  await reconcileDailyCron({ headers: { authorization: `Bearer ${CRON_SECRET}` }, query: {} }, res);
  return res;
};

const makeMismatch = () => {
  const { from } = getYesterdayPeriodUtc();
  const at = new Date(from.getTime() + 3600_000);
  store.set(oid(1), { _id: oid(1), currency: 'EUR', totalPrice: 10, paymentMethod: 'card', paymentStatus: 'Payé', paidAt: at, updatedAt: at });
  listImpl = async () => ({ has_more: false, data: [{ id: 'txn_1', amount: 2000, fee: 0, currency: 'eur', reporting_category: 'charge' }] });
};

test.beforeEach((t) => {
  store.clear(); double.reset(); reports.clear(); mails = [];
  mailImpl = async () => ({ sent: true });
  listImpl = async () => ({ has_more: false, data: [] });
  behaviour.failUpdateOne = false; behaviour.failFindOneAndUpdate = false;
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.ALERT_EMAIL = ALERT;
  delete process.env.PARTNER_NOTIFY_EMAIL;
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
});
test.after(() => {
  mailer.sendMail = realSend;
  for (const name of ['CRON_SECRET', 'ALERT_EMAIL', 'PARTNER_NOTIFY_EMAIL']) delete process.env[name];
});

test('mismatch : un seul e-mail vers ALERT_EMAIL, sans donnée personnelle ni identifiant', async () => {
  makeMismatch();
  const res = await cron();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'mismatch');
  assert.equal(mails.length, 1);
  const [mail] = mails;
  assert.equal(mail.to, ALERT);
  assert.match(mail.subject, /Écarts de rapprochement/);
  assert.match(mail.text, /charge_missing : 1/);
  assert.match(mail.text, /stripe_total_mismatch : 1/);
  assert.match(mail.text, /EUR : ledger 0\.00 \/ Stripe 20\.00/);
  assert.match(mail.text, /Période : /);
  for (const forbidden of [oid(1), 'txn_1', 'pi_', 'orderId']) assert.ok(!mail.text.includes(forbidden), forbidden);
  assert.ok([...reports.values()][0].alertSentAt instanceof Date);
});

test('ok : aucun e-mail et aucune marque d\'alerte', async () => {
  const res = await cron();
  assert.equal(res.body.status, 'ok');
  assert.equal(mails.length, 0);
  assert.equal([...reports.values()][0].alertedStatus, undefined);
});

test('mailer qui échoue (réponse non envoyée ou exception) : réponse identique, marque retirée pour réessayer', async () => {
  makeMismatch();
  const reference = (await cron()).body;
  reports.clear(); mails = [];

  for (const impl of [async () => ({ sent: false, reason: 'HTTP_500' }), async () => { throw new Error('panne mailer'); }]) {
    mailImpl = impl;
    const res = await cron();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, reference);
    assert.equal([...reports.values()][0].alertedStatus, undefined, 'envoi raté : une relance doit pouvoir réessayer');
    reports.clear();
  }
});

test('relance le même jour : pas de second e-mail ; après un échec d\'envoi, la relance réessaie', async () => {
  makeMismatch();
  await cron();
  await cron();
  assert.equal(mails.length, 1);

  reports.clear(); mails = [];
  mailImpl = async () => ({ sent: false, reason: 'NETWORK' });
  await cron();
  mailImpl = async () => ({ sent: true });
  await cron();
  await cron();
  assert.equal(mails.length, 2, 'envoi raté, envoi réussi à la relance, puis plus rien');
});

test('envois simultanés : la marque atomique empêche le doublon', async () => {
  makeMismatch();
  await Promise.all([cron(), cron(), cron()]);
  assert.equal(mails.length, 1);
});

test('ALERT_EMAIL absent : rien, ni e-mail ni accès à la base pour l\'alerte ; repli sur PARTNER_NOTIFY_EMAIL', async () => {
  makeMismatch();
  delete process.env.ALERT_EMAIL;
  let touched = 0;
  const original = LedgerReconciliationReport.updateOne;
  LedgerReconciliationReport.updateOne = async (...args) => { touched += 1; return original(...args); };
  try {
    const res = await cron();
    assert.equal(res.statusCode, 200);
    assert.equal(mails.length, 0);
    assert.equal(touched, 0);

    process.env.PARTNER_NOTIFY_EMAIL = 'equipe@exemple.ch';
    reports.clear();
    await cron();
    assert.deepEqual(mails.map((m) => m.to), ['equipe@exemple.ch']);
  } finally {
    LedgerReconciliationReport.updateOne = original;
  }
  assert.equal(resolveRecipient({ ALERT_EMAIL: 'pas une adresse' }), null);
  assert.equal(resolveRecipient({ ALERT_EMAIL: ' a@b.ch ' }), 'a@b.ch');
});

test('rapprochement en échec (stockage du rapport) : 500 inchangé et un e-mail d\'alerte, une seule fois par rapport', async () => {
  behaviour.failFindOneAndUpdate = true;
  const res = await cron();
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { success: false, message: 'Rapprochement du ledger impossible.' });
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /en échec/);
  assert.ok(!/stockage indisponible/.test(mails[0].text), 'aucun message d\'erreur dans l\'e-mail');

  // Avec un rapport déjà marqué « failed » pour la période : pas de second e-mail.
  behaviour.failFindOneAndUpdate = false;
  const { from, to } = getYesterdayPeriodUtc();
  reports.set(keyOf({ periodStart: from, periodEnd: to }), { periodStart: from, periodEnd: to, alertedStatus: 'failed' });
  behaviour.failFindOneAndUpdate = true;
  mails = [];
  await cron();
  assert.equal(mails.length, 0);
});

test('base indisponible pour l\'alerte : réponse inchangée (mismatch : pas d\'e-mail ; échec : alerte sans dédoublonnage)', async () => {
  makeMismatch();
  behaviour.failUpdateOne = true;
  const res = await cron();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'mismatch');
  assert.equal(mails.length, 0);

  behaviour.failFindOneAndUpdate = true;
  const failed = await cron();
  assert.equal(failed.statusCode, 500);
  assert.equal(mails.length, 1);
});

test('corps de l\'e-mail : valeurs hostiles neutralisées, aucune liste d\'identifiants', () => {
  const { from, to } = getYesterdayPeriodUtc();
  const mail = buildAlertEmail({
    kind: 'mismatch', period: { from, to }, discrepancyCount: 3, truncated: true, stripeComplete: false,
    countsByKind: { 'weird kind\n<script>': 2 },
    ledgerTotals: [{ type: 'charge', currency: 'eur\nBcc: x', totalMinor: 1000 }],
    stripeTotals: [],
  });
  assert.ok(!mail.text.includes('<script>'));
  assert.ok(!mail.text.includes('Bcc: x'));
  assert.match(mail.text, /tronquée/);
  assert.match(mail.text, /Stripe incomplètes/);
  assert.equal(buildAlertEmail({ kind: 'failed', period: { from, to } }).text.includes('Écarts par type'), false);
});

test('le mailer réel n\'est jamais appelé : sans clé Resend il ignore l\'envoi sans réseau', async () => {
  delete process.env.RESEND_API_KEY;
  assert.deepEqual(await realSend({ to: ALERT, subject: 's', text: 't' }), { sent: false, reason: 'NOT_CONFIGURED' });
});
