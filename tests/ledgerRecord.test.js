'use strict';

// utils/ledger.js : écriture idempotente, échec ouvert, constructeurs d'écritures (signes, devises).
// Le modèle LedgerEntry est remplacé par un double en mémoire (aucune base, aucun réseau).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { installLedgerDouble } = require('./helpers/ledgerHarness');

const double = installLedgerDouble();
const ledger = require('../utils/ledger');

const oid = () => new mongoose.Types.ObjectId().toString();
const base = (overrides = {}) => ({
  type: 'charge', order: oid(), currency: 'EUR', amountMinor: 1000, party: 'customer',
  idempotencyKey: `charge:order:${crypto.randomBytes(6).toString('hex')}`, occurredAt: new Date(), ...overrides,
});

test.beforeEach((t) => {
  double.reset();
  t.mock.method(console, 'error', () => {});
});

test('même écriture rejouée deux fois : une seule écriture', async () => {
  const entry = base();
  assert.equal((await ledger.recordEntry(entry)).status, 'recorded');
  assert.equal((await ledger.recordEntry(entry)).status, 'duplicate');
  assert.equal(double.entries.length, 1);
});

test('course entre deux rejeux : l\'index unique (E11000) est traité comme un doublon, sans erreur', async () => {
  const entry = base();
  await ledger.recordEntry(entry);
  // Simule la lecture qui ne voit pas encore l'écriture concurrente : seul l'index unique tranche.
  const originalFindOne = double.LedgerEntry.findOne;
  double.LedgerEntry.findOne = () => ({ select() { return this; }, lean() { return this; }, then: (resolve) => resolve(null) });
  const result = await ledger.recordEntry(entry);
  double.LedgerEntry.findOne = originalFindOne;
  assert.equal(result.status, 'duplicate');
  assert.equal(double.entries.length, 1);
});

test('échec ouvert : une écriture invalide ne lève pas et n\'écrit rien', async () => {
  const bad = [
    null, {}, base({ type: 'inconnu' }), base({ party: 'x' }), base({ currency: 'EURO' }), base({ amountMinor: 0 }),
    base({ amountMinor: 10.5 }), base({ amountMinor: '100' }), base({ idempotencyKey: '' }), base({ order: 'pas-un-id' }),
  ];
  for (const entry of bad) assert.equal((await ledger.recordEntry(entry)).status, 'error');
  assert.equal(double.entries.length, 0);
});

test('échec ouvert : erreur d\'écriture, de lecture ou base non prête -> ne lève jamais', async () => {
  double.state.failCreate = Object.assign(new Error('write failed'), { code: 8000 });
  assert.equal((await ledger.recordEntry(base())).status, 'error');
  double.state.failCreate = null;

  double.state.failFind = new Error('boom');
  assert.equal((await ledger.recordEntry(base())).status, 'error');
  double.state.failFind = null;

  double.state.ready = false;
  const before = double.state.createCalls;
  assert.equal((await ledger.recordEntry(base())).status, 'skipped');
  assert.equal(double.state.createCalls, before);
});

test('échec ouvert : un ledger qui ne répond pas est abandonné après le délai', async () => {
  const originalFindOne = double.LedgerEntry.findOne;
  double.LedgerEntry.findOne = () => ({ select() { return this; }, lean() { return this; }, then: () => {} });
  try {
    const startedAt = Date.now();
    const result = await ledger.recordEntry(base(), { timeoutMs: 30 });
    assert.equal(result.status, 'error');
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    double.LedgerEntry.findOne = originalFindOne;
  }
});

test('journal d\'erreur : ni message brut, ni montant, ni identifiant client', async () => {
  const secret = crypto.randomBytes(8).toString('hex');
  double.state.failCreate = Object.assign(new Error(`connexion ${secret}`), { code: 'ECONN' });
  await ledger.recordEntry(base({ amountMinor: 987654 }));
  const logged = JSON.stringify(console.error.mock.calls.map((call) => call.arguments));
  assert.ok(logged.includes('LEDGER ERROR'));
  assert.ok(!logged.includes(secret));
  assert.ok(!logged.includes('987654'));
});

test('meta : nettoyée (primitives seulement, valeurs tronquées), jamais d\'objet imbriqué stocké', async () => {
  await ledger.recordEntry(base({ meta: { ok: 'a'.repeat(300), nested: { x: 1 }, list: [1], n: 5, flag: true } }));
  const stored = double.entries[0].meta;
  assert.deepEqual(Object.keys(stored).sort(), ['flag', 'n', 'ok']);
  assert.equal(stored.ok.length, 100);
});

// --- Constructeurs : signes et unités mineures selon la devise ---

const order = (overrides = {}) => ({
  _id: oid(), currency: 'EUR', totalPrice: 12.5, paymentMethod: 'card', paidAt: new Date('2026-03-01T10:00:00Z'),
  restaurantEarning: 8, driverEarning: 3, stripePaymentIntentId: 'pi_x', ...overrides,
});

test('charge : positive, EUR en centimes, XOF et XAF en unités entières', () => {
  const o = order();
  assert.equal(ledger.buildChargeEntry(o).amountMinor, 1250);
  assert.equal(ledger.buildChargeEntry(o).idempotencyKey, `charge:order:${o._id}`);
  assert.equal(ledger.buildChargeEntry(order({ currency: 'XOF', totalPrice: 5000 })).amountMinor, 5000);
  assert.equal(ledger.buildChargeEntry(order({ currency: 'XAF', totalPrice: 3500 })).amountMinor, 3500);
  assert.equal(ledger.buildChargeEntry(order({ totalPrice: 0 })), null);
  assert.equal(ledger.buildChargeEntry(order({ currency: 'JPY', totalPrice: 10 })), null);
});

test('remboursement négatif (Stripe fournit déjà les unités mineures), clé = identifiant du remboursement', () => {
  const o = order({ currency: 'XOF', totalPrice: 5000 });
  const entry = ledger.buildRefundEntry(o, { id: 're_1', amount: 5000, currency: 'xof', created: 1772000000 });
  assert.equal(entry.amountMinor, -5000);
  assert.equal(entry.idempotencyKey, 'refund:re_1');
  assert.equal(entry.occurredAt.getTime(), 1772000000 * 1000);
  assert.equal(ledger.buildRefundEntry(o, { id: 're_2', amount: 0 }), null);
  assert.equal(ledger.buildRefundEntry(o, { amount: 100 }), null);
});

test('transfert négatif, réversion positive, litige perdu négatif ; partenaires corrects', () => {
  const o = order();
  const transfer = ledger.buildTransferEntry(o, 'restaurant', 'tr_1', {});
  assert.deepEqual([transfer.amountMinor, transfer.party, transfer.idempotencyKey], [-800, 'restaurant', 'transfer:tr_1']);
  const courier = ledger.buildTransferEntry(o, 'courier', 'tr_2', {});
  assert.deepEqual([courier.amountMinor, courier.party], [-300, 'courier']);
  const reversal = ledger.buildTransferReversalEntry(o, 'courier', 'trr_2', { amountMinor: 300 });
  assert.deepEqual([reversal.amountMinor, reversal.type, reversal.idempotencyKey], [300, 'transfer_reversal', 'transfer_reversal:trr_2']);
  const dispute = ledger.buildDisputeLostEntry(o, { id: 'dp_1', amount: 1250, currency: 'eur', reason: 'fraudulent' });
  assert.deepEqual([dispute.amountMinor, dispute.party, dispute.idempotencyKey], [-1250, 'customer', 'dispute_lost:dp_1']);
  const xof = order({ currency: 'XOF', restaurantEarning: 4000 });
  assert.equal(ledger.buildTransferEntry(xof, 'restaurant', 'tr_3', {}).amountMinor, -4000);
});

test('espèces : créance positive à l\'encaissement, négative au règlement ; seulement si commission due ou soldée', () => {
  const restaurantHolds = order({ paymentMethod: 'cash', cashCommissionStatus: 'due', selfDelivery: true, platformCommissionAmount: 1.5 });
  assert.deepEqual(
    [ledger.buildCashEntry(restaurantHolds, 'cash_collected').amountMinor, ledger.buildCashEntry(restaurantHolds, 'cash_collected').party],
    [150, 'restaurant']
  );
  const courierHolds = order({ paymentMethod: 'cash', cashCommissionStatus: 'settled', totalPrice: 20, driverEarning: 3, tipAmount: 2, cashCommissionSettledAt: new Date() });
  const settled = ledger.buildCashEntry(courierHolds, 'cash_settled');
  assert.deepEqual([settled.amountMinor, settled.party], [-1500, 'courier']);
  assert.equal(ledger.buildCashEntry(order({ paymentMethod: 'cash', cashCommissionStatus: 'none' }), 'cash_collected'), null);
  assert.equal(ledger.buildCashEntry(order({ paymentMethod: 'card', cashCommissionStatus: 'due' }), 'cash_collected'), null);
  const xaf = order({ paymentMethod: 'cash', cashCommissionStatus: 'due', currency: 'XAF', totalPrice: 6000, driverEarning: 1000, tipAmount: 500 });
  assert.equal(ledger.buildCashEntry(xaf, 'cash_collected').amountMinor, 4500);
});

test('summarizeLedger : totaux par type et par devise sur la période semi-ouverte', async () => {
  const at = (iso) => new Date(iso);
  await ledger.recordEntry(base({ type: 'charge', amountMinor: 1000, occurredAt: at('2026-03-01T00:00:00Z') }));
  await ledger.recordEntry(base({ type: 'charge', amountMinor: 500, occurredAt: at('2026-03-01T12:00:00Z') }));
  await ledger.recordEntry(base({ type: 'refund', amountMinor: -400, occurredAt: at('2026-03-01T13:00:00Z') }));
  await ledger.recordEntry(base({ type: 'charge', currency: 'XOF', amountMinor: 5000, occurredAt: at('2026-03-01T14:00:00Z') }));
  await ledger.recordEntry(base({ type: 'charge', amountMinor: 999, occurredAt: at('2026-03-02T00:00:00Z') })); // borne `to` exclue
  const rows = await ledger.summarizeLedger({ from: at('2026-03-01T00:00:00Z'), to: at('2026-03-02T00:00:00Z') });
  assert.deepEqual(rows, [
    { type: 'charge', currency: 'EUR', count: 2, totalMinor: 1500 },
    { type: 'refund', currency: 'EUR', count: 1, totalMinor: -400 },
    { type: 'charge', currency: 'XOF', count: 1, totalMinor: 5000 },
  ]);
});
