'use strict';

// Espèces : écriture cash_settled au règlement admin (cashLedgerController), échec ouvert.
// Order et LedgerEntry sont des doubles en mémoire.

const test = require('node:test');
const assert = require('node:assert/strict');
const { installLedgerDouble, patchOrderFind, matchDoc } = require('./helpers/ledgerHarness');

process.env.JWT_SECRET = 'x'.repeat(48);
const double = installLedgerDouble();
const Order = require('../models/Order');
const { settleCashLedger } = require('../controllers/cashLedgerController');
const ledger = require('../utils/ledger');

const store = new Map();
patchOrderFind(Order, store);
Order.updateMany = async (filter, update) => {
  let modifiedCount = 0;
  for (const doc of store.values()) {
    if (matchDoc(doc, filter)) { Object.assign(doc, update.$set); modifiedCount += 1; }
  }
  return { modifiedCount };
};

const oid = (n) => `64b00000000000000000${String(n).padStart(4, '0')}`;
const REST = oid(900);
const COURIER = oid(901);
const cashOrder = (n, overrides = {}) => {
  const doc = {
    _id: oid(n), paymentMethod: 'cash', status: 'Livrée', currency: 'EUR', totalPrice: 20, driverEarning: 3, tipAmount: 2,
    platformCommissionAmount: 1.5, cashCommissionStatus: 'due', restaurant: REST, selfDelivery: false, fulfillment: 'delivery',
    deliveryPerson: COURIER, ...overrides,
  };
  store.set(doc._id, doc);
  return doc;
};
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const settle = async (kind, id) => { const r = res(); await settleCashLedger({ params: { kind, id } }, r); return r; };

test.beforeEach((t) => { store.clear(); double.reset(); t.mock.method(console, 'error', () => {}); });

test('règlement livreur : une écriture cash_settled négative par commande soldée, rejouée sans doublon', async () => {
  cashOrder(1); cashOrder(2, { totalPrice: 30 });
  cashOrder(3, { deliveryPerson: oid(777) }); // autre livreur : non concernée
  const result = await settle('courier', COURIER);
  assert.deepEqual(result.body, { success: true, settled: 2 });
  assert.deepEqual(
    double.byType('cash_settled').map((e) => [e.party, e.amountMinor, e.idempotencyKey]).sort(),
    [['courier', -1500, `cash_settled:${oid(1)}`], ['courier', -2500, `cash_settled:${oid(2)}`]]
  );
  assert.equal((await settle('courier', COURIER)).body.settled, 0);
  assert.equal(double.byType('cash_settled').length, 2);
});

test('règlement restaurant : commission en unités mineures (XOF entier)', async () => {
  cashOrder(4, { selfDelivery: true, deliveryPerson: null, currency: 'XOF', platformCommissionAmount: 600 });
  await settle('restaurant', REST);
  assert.deepEqual(double.byType('cash_settled').map((e) => [e.party, e.amountMinor, e.currency]), [['restaurant', -600, 'XOF']]);
});

test('règlement, ledger en panne : le règlement est quand même effectué et la réponse inchangée', async () => {
  double.state.failCreate = new Error('ledger down');
  cashOrder(5);
  const result = await settle('courier', COURIER);
  assert.deepEqual(result.body, { success: true, settled: 1 });
  assert.equal(store.get(oid(5)).cashCommissionStatus, 'settled');
  assert.equal(double.entries.length, 0);
});

test('règlement, lecture des commandes en échec : règlement et réponse inchangés', async () => {
  cashOrder(6);
  const originalFind = Order.find;
  Order.find = () => { throw new Error('read down'); };
  const result = await settle('courier', COURIER);
  Order.find = originalFind;
  assert.deepEqual(result.body, { success: true, settled: 1 });
});

test('encaissement : écriture cash_collected seulement pour une commande espèces dont la commission est due', async () => {
  const delivered = cashOrder(7, { deliveredAt: new Date('2026-03-01T12:00:00Z') });
  await ledger.recordCashCollected(delivered);
  await ledger.recordCashCollected(delivered);
  await ledger.recordCashCollected({ ...delivered, _id: oid(8), paymentMethod: 'card' });
  await ledger.recordCashCollected({ ...delivered, _id: oid(9), cashCommissionStatus: 'none' });
  assert.deepEqual(double.byType('cash_collected').map((e) => [e.party, e.amountMinor]), [['courier', 1500]]);
});
