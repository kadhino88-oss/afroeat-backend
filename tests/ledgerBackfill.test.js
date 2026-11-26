'use strict';

// Backfill du ledger : simulation par défaut, idempotent, mêmes clés que le direct, garde sur la base.
// Order et LedgerEntry sont des doubles en mémoire ; le script n'est jamais exécuté contre une base.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { installLedgerDouble, patchOrderFind } = require('./helpers/ledgerHarness');

process.env.JWT_SECRET = 'x'.repeat(48);
const double = installLedgerDouble();
const Order = require('../models/Order');
const ledger = require('../utils/ledger');
const { backfillLedger, buildOrderEntries, isExpectedDatabase, parseArgs } = require('../utils/ledgerBackfill');

const store = new Map();
patchOrderFind(Order, store);
const oid = (n) => `64b00000000000000000${String(n).padStart(4, '0')}`;
const addOrder = (n, overrides = {}) => {
  const doc = {
    _id: oid(n), currency: 'EUR', totalPrice: 10, paymentMethod: 'card', paymentStatus: 'Payé', stripePaymentIntentId: `pi_${n}`,
    paidAt: new Date('2026-03-01T10:00:00Z'), createdAt: new Date('2026-03-01T09:59:00Z'), updatedAt: new Date('2026-03-01T11:00:00Z'),
    restaurantEarning: 7, driverEarning: 2, ...overrides,
  };
  store.set(doc._id, doc);
  return doc;
};

test.beforeEach((t) => { store.clear(); double.reset(); t.mock.method(console, 'error', () => {}); });

const seed = () => {
  addOrder(1);
  addOrder(2, { currency: 'XOF', totalPrice: 5000, restaurantEarning: 3500, driverEarning: 800, paymentStatus: 'Remboursé', stripeRefundId: 're_2', stripeAmountRefunded: 5000, refundedAt: new Date('2026-03-02T00:00:00Z') });
  addOrder(3, { stripeRestaurantTransferId: 'tr_3r', stripeCourierTransferId: 'tr_3c', stripeRestaurantReversalId: 'trr_3r', payoutUpdatedAt: new Date('2026-03-01T12:00:00Z') });
  addOrder(4, { paymentMethod: 'cash', paymentStatus: 'Payé' }); // espèces : ignorée
  addOrder(5, { paymentStatus: 'Non payé' }); // non payée : ignorée
};

test('simulation (défaut) : compte ce qui serait créé, n\'écrit rien', async () => {
  seed();
  const report = await backfillLedger();
  assert.equal(report.apply, false);
  assert.equal(report.ordersScanned, 3);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.byType).map(([type, s]) => [type, [s.planned, s.existing, s.recorded]])),
    { charge: [3, 0, 0], refund: [1, 0, 0], transfer: [2, 0, 0], transfer_reversal: [1, 0, 0] }
  );
  assert.equal(double.entries.length, 0);
  assert.equal(double.state.createCalls, 0);
});

test('apply : écritures créées avec les mêmes clés que le direct ; second passage = aucune écriture de plus', async () => {
  seed();
  const first = await backfillLedger({ apply: true });
  assert.equal(first.byType.charge.recorded, 3);
  assert.equal(double.entries.length, 7);
  const keys = double.entries.map((e) => e.idempotencyKey).sort();
  assert.deepEqual(keys, [
    `charge:order:${oid(1)}`, `charge:order:${oid(2)}`, `charge:order:${oid(3)}`, 'refund:re_2',
    'transfer:tr_3c', 'transfer:tr_3r', 'transfer_reversal:trr_3r',
  ].sort());

  const second = await backfillLedger({ apply: true });
  assert.equal(second.byType.charge.recorded, 0);
  assert.equal(second.byType.charge.existing, 3);
  assert.equal(double.entries.length, 7);
  assert.equal(double.state.createCalls, 7);
});

test('montants : XOF en unités entières, remboursement négatif, transferts négatifs, réversion positive, meta.backfill', async () => {
  seed();
  await backfillLedger({ apply: true });
  const by = (key) => double.entries.find((e) => e.idempotencyKey === key);
  assert.equal(by(`charge:order:${oid(1)}`).amountMinor, 1000);
  assert.equal(by(`charge:order:${oid(2)}`).amountMinor, 5000);
  assert.equal(by('refund:re_2').amountMinor, -5000);
  assert.equal(by('transfer:tr_3r').amountMinor, -700);
  assert.equal(by('transfer:tr_3c').amountMinor, -200);
  assert.equal(by('transfer_reversal:trr_3r').amountMinor, 700);
  assert.ok(double.entries.every((e) => e.meta.backfill === true));
});

test('écritures déjà faites en direct : non dupliquées ; remboursement déjà enregistré : jamais reconstruit', async () => {
  seed();
  await ledger.recordCharge(store.get(oid(1)), { paymentIntentId: 'pi_1' });
  await ledger.recordRefund(store.get(oid(2)), { id: 're_live', amount: 2000, currency: 'xof' }); // cumul incomplet côté commande
  const report = await backfillLedger({ apply: true });
  assert.equal(report.byType.charge.existing, 1);
  assert.equal(report.byType.refund.planned, 0);
  assert.equal(double.byType('refund').length, 1);
  assert.equal(double.byType('charge').length, 3);
});

test('une panne du ledger pendant le backfill est comptée en erreur sans interrompre ni lever', async () => {
  seed();
  double.state.failCreate = new Error('ledger down');
  const report = await backfillLedger({ apply: true });
  assert.equal(report.byType.charge.errors, 3);
  assert.equal(report.byType.charge.recorded, 0);
});

test('pagination : les lots successifs couvrent toutes les commandes', async () => {
  for (let n = 1; n <= 7; n += 1) addOrder(n);
  const report = await backfillLedger({ apply: true, batchSize: 3 });
  assert.equal(report.ordersScanned, 7);
  assert.equal(double.byType('charge').length, 7);
});

test('buildOrderEntries : commande sans remboursement identifiable -> pas d\'écriture refund', () => {
  const entries = buildOrderEntries({ ...addOrder(9), refundedAt: new Date(), stripeRefundId: undefined });
  assert.deepEqual(entries.map((e) => e.type), ['charge']);
});

test('arguments : --dry-run par défaut, --apply explicite, combinaison ou option inconnue refusées', () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true });
  assert.deepEqual(parseArgs(['--dry-run']), { apply: false, dryRun: true });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, dryRun: false });
  assert.ok(parseArgs(['--apply', '--dry-run']).error);
  assert.ok(parseArgs(['--force']).error);
});

test('garde sur le nom de base : EXPECT_DB, sinon staging uniquement', () => {
  assert.equal(isExpectedDatabase('afroeat_staging', {}), true);
  assert.equal(isExpectedDatabase('afroeat', {}), false);
  assert.equal(isExpectedDatabase('afroeat', { EXPECT_DB: 'afroeat' }), true);
  assert.equal(isExpectedDatabase('afroeat_staging', { EXPECT_DB: 'afroeat' }), false);
  assert.equal(isExpectedDatabase('', {}), false);
});

test('script : refuse de démarrer sans MONGO_URI ou avec des options contradictoires (aucune connexion tentée)', () => {
  const script = path.join(__dirname, '..', 'scripts', 'backfill-ledger.js');
  const run = (args) => spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH }, encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 20000,
  });
  const noUri = run([]);
  assert.equal(noUri.status, 1);
  assert.match(noUri.stderr, /MONGO_URI/);
  const both = run(['--apply', '--dry-run']);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /dry-run|apply/);
});
