'use strict';

// Rapprochement du ledger : validation des dates, synthèse admin, ledger contre commandes, ledger contre Stripe,
// cron quotidien protégé par CRON_SECRET, limiteurs sur les routes. Doubles en mémoire, aucun réseau.

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
const { parseIsoInstant, parsePeriod, getYesterdayPeriodUtc } = require('../utils/ledgerDates');
const {
  reconcileLedgerWithOrders, fetchStripeBalanceTotals, compareLedgerWithStripe,
} = require('../utils/ledgerReconciliation');
const { getLedgerSummary, reconcileDailyCron } = require('../controllers/ledgerController');
const ledger = require('../utils/ledger');

patchOrderFind(Order, store);
const CRON_SECRET = crypto.randomBytes(24).toString('hex');
const oid = (n) => `64b00000000000000000${String(n).padStart(4, '0')}`;
const day = (d, hour = 10) => new Date(Date.UTC(2026, 2, d, hour));
const PERIOD = { from: day(1, 0), to: day(2, 0) };

test.beforeEach((t) => {
  store.clear(); double.reset();
  process.env.CRON_SECRET = CRON_SECRET;
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
});
test.after(() => { delete process.env.CRON_SECRET; });

// --- Validation des dates -------------------------------------------------------------------

test('dates : formats ISO UTC valides', () => {
  assert.equal(parseIsoInstant('2026-03-01').toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(parseIsoInstant('2026-03-01T10:20:30Z').toISOString(), '2026-03-01T10:20:30.000Z');
  assert.equal(parseIsoInstant('2026-03-01T10:20:30.123Z').toISOString(), '2026-03-01T10:20:30.123Z');
  assert.equal(parseIsoInstant('2028-02-29').toISOString(), '2028-02-29T00:00:00.000Z');
});

test('dates : formats et valeurs invalides refusés (jours inexistants, fuseaux, espaces, chiffres non ASCII)', () => {
  const invalid = [
    '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-03-00', '2026-04-31', '2026-03-01T24:00:00Z',
    '2026-03-01T10:60:00Z', '2026-03-01T10:20:60Z', '2026-03-01T10:20:30+01:00', '2026-03-01T10:20:30',
    '2026-03-01T10:20:30.12Z', '2026-03-01T10:20:30.1234Z', '2026-03-01t10:20:30z', '20260301', '2026-3-1',
    ' 2026-03-01', '2026-03-01 ', '2026-03-01\n', '1999-12-31', '2101-01-01', '２０２６-03-01', '2026/03/01', '',
    'now', '2026-03-01T10:20Z', 'abcd-ef-gh',
  ];
  for (const value of invalid) assert.equal(parseIsoInstant(value), null, JSON.stringify(value));
  for (const value of [null, undefined, 20260301, {}, [], ['2026-03-01'], true]) assert.equal(parseIsoInstant(value), null);
});

test('dates : entrées hostiles très longues rejetées immédiatement (aucun parcours quadratique)', () => {
  const startedAt = process.hrtime.bigint();
  for (const hostile of ['9'.repeat(5_000_000), `2026-03-01${'0'.repeat(5_000_000)}`, `${'-'.repeat(2_000_000)}Z`, 'T'.repeat(3_000_000)]) {
    assert.equal(parseIsoInstant(hostile), null);
    assert.equal(parsePeriod({ from: hostile, to: hostile }).ok, false);
  }
  assert.ok(Number(process.hrtime.bigint() - startedAt) / 1e6 < 200, 'le rejet doit être quasi instantané');
});

test('période : from et to obligatoires, from < to, 366 jours au maximum', () => {
  assert.equal(parsePeriod({}).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: '2026-03-01' }).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: ['2026-03-01', '2026-03-02'], to: '2026-03-03' }).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: { $gt: '' }, to: '2026-03-03' }).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: 'nope', to: '2026-03-03' }).code, 'INVALID_DATE');
  assert.equal(parsePeriod({ from: '2026-03-02', to: '2026-03-02' }).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: '2026-03-03', to: '2026-03-02' }).code, 'INVALID_PERIOD');
  assert.equal(parsePeriod({ from: '2026-01-01', to: '2027-01-02' }).ok, true); // 366 jours
  assert.equal(parsePeriod({ from: '2026-01-01', to: '2027-01-03' }).code, 'PERIOD_TOO_LONG'); // 367 jours
  assert.equal(parsePeriod({ from: '2020-01-01', to: '2026-01-01' }).code, 'PERIOD_TOO_LONG');
});

test('la veille en UTC : [00:00 hier, 00:00 aujourd\'hui)', () => {
  const { from, to } = getYesterdayPeriodUtc(new Date('2026-03-05T23:59:59Z'));
  assert.equal(from.toISOString(), '2026-03-04T00:00:00.000Z');
  assert.equal(to.toISOString(), '2026-03-05T00:00:00.000Z');
});

// --- Synthèse admin ----------------------------------------------------------------------------

const call = async (handler, req) => { const res = createRes(); await handler(req, res); return res; };

test('synthèse admin : 400 sur dates invalides ou hostiles, sans toucher au ledger', async () => {
  for (const query of [{}, { from: '2026-02-30', to: '2026-03-01' }, { from: 'x'.repeat(100000), to: '2026-03-01' }, { from: '2026-01-01', to: '2030-01-01' }]) {
    const res = await call(getLedgerSummary, { query });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  }
});

test('synthèse admin : totaux par type et par devise, net par devise, EUR en centimes et XOF en unités', async () => {
  const add = (overrides) => ledger.recordEntry({
    type: 'charge', order: oid(1), currency: 'EUR', amountMinor: 1000, party: 'customer', occurredAt: day(1),
    idempotencyKey: `k_${crypto.randomBytes(5).toString('hex')}`, ...overrides,
  });
  await add({ amountMinor: 1250 });
  await add({ type: 'refund', amountMinor: -250 });
  await add({ currency: 'XOF', amountMinor: 5000 });
  await add({ amountMinor: 999, occurredAt: day(5) }); // hors période
  const res = await call(getLedgerSummary, { query: { from: '2026-03-01', to: '2026-03-02' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.totals, [
    { type: 'charge', currency: 'EUR', count: 1, totalMinor: 1250, total: 12.5 },
    { type: 'refund', currency: 'EUR', count: 1, totalMinor: -250, total: -2.5 },
    { type: 'charge', currency: 'XOF', count: 1, totalMinor: 5000, total: 5000 },
  ]);
  assert.deepEqual(res.body.net, [
    { currency: 'EUR', totalMinor: 1000, total: 10 },
    { currency: 'XOF', totalMinor: 5000, total: 5000 },
  ]);
});

// --- Ledger contre commandes -------------------------------------------------------------------

const paidOrder = (n, overrides = {}) => {
  const doc = { _id: oid(n), currency: 'EUR', totalPrice: 10, paymentMethod: 'card', paymentStatus: 'Payé', paidAt: day(1), updatedAt: day(1), ...overrides };
  store.set(doc._id, doc);
  return doc;
};
const entry = (order, type, amountMinor, extra = {}) => ledger.recordEntry({
  type, order: order._id, currency: order.currency, amountMinor, party: type === 'charge' || type === 'refund' ? 'customer' : 'restaurant',
  occurredAt: day(1), idempotencyKey: `${type}:${order._id}:${crypto.randomBytes(4).toString('hex')}`, ...extra,
});

test('rapprochement sans écart : charge, remboursement et transfert présents et corrects', async () => {
  const a = paidOrder(1);
  await entry(a, 'charge', 1000, { stripeObjectId: 'pi_1' });
  const b = paidOrder(2, { currency: 'XOF', totalPrice: 5000, stripeAmountRefunded: 5000, refundedAt: day(1), paymentStatus: 'Remboursé' });
  await entry(b, 'charge', 5000, { stripeObjectId: 'pi_2' });
  await entry(b, 'refund', -5000, { stripeObjectId: 're_2' });
  const c = paidOrder(3, { restaurantEarning: 7, stripeRestaurantTransferId: 'tr_1', stripeRestaurantReversalId: 'trr_1', payoutUpdatedAt: day(1) });
  await entry(c, 'charge', 1000, { stripeObjectId: 'pi_3' });
  await entry(c, 'transfer', -700, { stripeObjectId: 'tr_1' });
  await entry(c, 'transfer_reversal', 700, { stripeObjectId: 'trr_1' });
  paidOrder(4, { paidAt: day(3) }); // hors période : ignorée même sans écriture

  const result = await reconcileLedgerWithOrders(PERIOD);
  assert.deepEqual(result.discrepancies, []);
  assert.deepEqual(result.counts, {});
  assert.equal(result.truncated, false);
  assert.deepEqual(result.orderTotals.charge, { EUR: 2000, XOF: 5000 });
});

test('rapprochement avec écarts : chaque anomalie est listée, rien n\'est corrigé', async () => {
  const missing = paidOrder(1);
  const wrong = paidOrder(2, { currency: 'XOF', totalPrice: 5000 });
  await entry(wrong, 'charge', 50, { stripeObjectId: 'pi_w' }); // XOF divisé par 100 par erreur
  const dup = paidOrder(3);
  await entry(dup, 'charge', 1000, { stripeObjectId: 'pi_d' });
  await entry(dup, 'charge', 1000, { stripeObjectId: 'pi_d' }); // même objet Stripe sous une autre clé
  const noRefund = paidOrder(4, { stripeAmountRefunded: 10, refundedAt: day(1) });
  await entry(noRefund, 'charge', 1000);
  const badRefund = paidOrder(5, { stripeAmountRefunded: 10, refundedAt: day(1) });
  await entry(badRefund, 'charge', 1000);
  await entry(badRefund, 'refund', -400, { stripeObjectId: 're_b' });
  const partial = paidOrder(6, { stripeAmountRefunded: 3, refundedAt: null, updatedAt: day(1) });
  await entry(partial, 'charge', 1000);
  const noTransfer = paidOrder(7, { restaurantEarning: 7, driverEarning: 2, stripeRestaurantTransferId: 'tr_x', stripeCourierTransferId: 'tr_y', stripeCourierReversalId: 'trr_y', payoutUpdatedAt: day(1) });
  await entry(noTransfer, 'charge', 1000);
  await entry(noTransfer, 'transfer', -999, { stripeObjectId: 'tr_y' }); // montant différent
  const snapshot = JSON.stringify([...store.values()]);

  const { counts, discrepancies, truncated } = await reconcileLedgerWithOrders(PERIOD);
  assert.deepEqual(counts, {
    charge_missing: 1, charge_amount_mismatch: 1, charge_duplicate: 1, refund_missing: 2, refund_amount_mismatch: 1,
    transfer_missing: 1, transfer_amount_mismatch: 1, transfer_reversal_missing: 1, ledger_duplicate: 1,
  });
  assert.equal(truncated, false);
  const find = (kind, orderId) => discrepancies.find((d) => d.kind === kind && (!orderId || d.orderId === orderId));
  assert.equal(find('charge_missing').orderId, missing._id);
  assert.deepEqual(find('charge_amount_mismatch'), { kind: 'charge_amount_mismatch', orderId: wrong._id, currency: 'XOF', expectedMinor: 5000, ledgerMinor: 50 });
  assert.equal(find('charge_duplicate').orderId, dup._id);
  assert.deepEqual(find('refund_amount_mismatch'), { kind: 'refund_amount_mismatch', orderId: badRefund._id, currency: 'EUR', expectedMinor: 1000, ledgerMinor: 400 });
  assert.ok(find('refund_missing', noRefund._id) && find('refund_missing', partial._id));
  assert.deepEqual(find('ledger_duplicate'), { kind: 'ledger_duplicate', type: 'charge', stripeObjectId: 'pi_d', count: 2 });
  assert.equal(find('transfer_missing').orderId, noTransfer._id);
  assert.equal(JSON.stringify([...store.values()]), snapshot, 'les commandes ne doivent jamais être modifiées');
});

test('rapprochement : la liste des écarts est bornée et signalée comme tronquée', async () => {
  for (let n = 1; n <= 230; n += 1) paidOrder(n);
  const result = await reconcileLedgerWithOrders(PERIOD);
  assert.equal(result.discrepancies.length, 200);
  assert.equal(result.counts.charge_missing, 230);
  assert.equal(result.truncated, true);
});

// --- Ledger contre Stripe ----------------------------------------------------------------------

test('Stripe : pagination bornée (starting_after, created gte/lt), totaux par type et devise, types inconnus à part', async () => {
  const pages = [
    { has_more: true, data: [
      { id: 'txn_1', amount: 1000, fee: 35, currency: 'eur', reporting_category: 'charge', type: 'charge' },
      { id: 'txn_2', amount: -400, fee: 0, currency: 'eur', reporting_category: 'refund', type: 'refund' },
    ] },
    { has_more: false, data: [
      { id: 'txn_3', amount: 5000, fee: 0, currency: 'xof', reporting_category: 'charge', type: 'charge' },
      { id: 'txn_4', amount: -9000, fee: 0, currency: 'eur', reporting_category: 'payout', type: 'payout' },
    ] },
  ];
  const seen = [];
  const fake = { balanceTransactions: { list: async (params) => { seen.push(params); return pages[seen.length - 1]; } } };
  const result = await fetchStripeBalanceTotals({ stripe: fake, ...PERIOD }, { pageSize: 2 });
  assert.equal(result.complete, true);
  assert.equal(result.transactions, 4);
  assert.deepEqual(seen.map((p) => p.starting_after), [undefined, 'txn_2']);
  assert.deepEqual(seen[0], { created: { gte: PERIOD.from.getTime() / 1000, lt: PERIOD.to.getTime() / 1000 }, limit: 2 });
  const total = (type, currency) => result.totals.find((r) => r.type === type && r.currency === currency)?.totalMinor;
  assert.equal(total('charge', 'EUR'), 1000);
  assert.equal(total('stripe_fee', 'EUR'), -35);
  assert.equal(total('refund', 'EUR'), -400);
  assert.equal(total('charge', 'XOF'), 5000);
  assert.deepEqual(result.unmapped, [{ type: 'payout', currency: 'EUR', count: 1, totalMinor: -9000 }]);
});

test('Stripe : au-delà du nombre de pages autorisé, le résultat est marqué incomplet', async () => {
  let calls = 0;
  const fake = { balanceTransactions: { list: async () => { calls += 1; return { has_more: true, data: [{ id: `t${calls}`, amount: 1, currency: 'eur', type: 'charge' }] }; } } };
  const result = await fetchStripeBalanceTotals({ stripe: fake, ...PERIOD }, { maxPages: 3 });
  assert.equal(calls, 3);
  assert.equal(result.complete, false);
});

test('comparaison ledger / Stripe : seuls les types comparables et les différences sont listés', () => {
  const ledgerTotals = [
    { type: 'charge', currency: 'EUR', count: 1, totalMinor: 1000 },
    { type: 'refund', currency: 'EUR', count: 1, totalMinor: -400 },
    { type: 'cash_collected', currency: 'EUR', count: 1, totalMinor: 700 },
  ];
  const stripeTotals = [
    { type: 'charge', currency: 'EUR', count: 1, totalMinor: 1000 },
    { type: 'refund', currency: 'EUR', count: 1, totalMinor: -300 },
    { type: 'stripe_fee', currency: 'EUR', count: 1, totalMinor: -35 },
  ];
  assert.deepEqual(compareLedgerWithStripe(ledgerTotals, stripeTotals), [
    { kind: 'stripe_total_mismatch', type: 'refund', currency: 'EUR', ledgerMinor: -400, stripeMinor: -300, diffMinor: -100 },
    { kind: 'stripe_total_mismatch', type: 'stripe_fee', currency: 'EUR', ledgerMinor: 0, stripeMinor: -35, diffMinor: 35 },
  ]);
});

// --- Cron quotidien ----------------------------------------------------------------------------

const reports = [];
LedgerReconciliationReport.findOneAndUpdate = async (filter, update) => { reports.push({ filter, update }); return {}; };
let listImpl = async () => ({ has_more: false, data: [] });
stripe.balanceTransactions = { list: (params) => listImpl(params) };
const cron = (authorization) => call(reconcileDailyCron, { headers: authorization === undefined ? {} : { authorization }, query: {} });

test.beforeEach(() => { reports.length = 0; listImpl = async () => ({ has_more: false, data: [] }); });

test('cron : CRON_SECRET absent -> 403, absent ou incorrect dans l\'en-tête -> 401, aucun accès aux données', async () => {
  paidOrder(1, { paidAt: getYesterdayPeriodUtc().from });
  let listCalls = 0;
  listImpl = async () => { listCalls += 1; return { has_more: false, data: [] }; };

  delete process.env.CRON_SECRET;
  assert.equal((await cron(`Bearer ${CRON_SECRET}`)).statusCode, 403);
  process.env.CRON_SECRET = CRON_SECRET;
  for (const header of [undefined, '', 'Bearer', 'Bearer wrong', `Bearer ${CRON_SECRET}x`, `Basic ${CRON_SECRET}`, CRON_SECRET, `Bearer ${'a'.repeat(100000)}`]) {
    const res = await cron(header);
    assert.equal(res.statusCode, 401, String(header).slice(0, 20));
    assert.equal(res.body.success, false);
  }
  assert.equal(listCalls, 0);
  assert.equal(reports.length, 0);
});

test('cron : veille sans écart -> rapport « ok », réponse = compteurs seulement', async () => {
  const { from } = getYesterdayPeriodUtc();
  const at = new Date(from.getTime() + 3600_000);
  const o = paidOrder(1, { paidAt: at, updatedAt: at, _id: oid(1) });
  await entry(o, 'charge', 1000, { occurredAt: at, stripeObjectId: 'pi_1' });
  listImpl = async () => ({ has_more: false, data: [{ id: 'txn_1', amount: 1000, fee: 0, currency: 'eur', reporting_category: 'charge' }] });

  const res = await cron(`Bearer ${CRON_SECRET}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, status: 'ok', discrepancies: 0, ordersScanned: 1, stripeTransactions: 1, stripeComplete: true, truncated: false });
  assert.equal(reports.length, 1);
  const { filter, update } = reports[0];
  assert.equal(filter.periodStart.getTime(), from.getTime());
  assert.equal(update.$set.status, 'ok');
  assert.deepEqual(update.$set.ledgerTotals, [{ type: 'charge', currency: 'EUR', count: 1, totalMinor: 1000 }]);
  assert.deepEqual(update.$set.stripeTotals, [{ type: 'charge', currency: 'EUR', count: 1, totalMinor: 1000 }]);
});

test('cron : écarts commandes et Stripe -> « mismatch », détails dans le rapport, jamais dans la réponse, rien corrigé', async () => {
  const { from } = getYesterdayPeriodUtc();
  const at = new Date(from.getTime() + 3600_000);
  paidOrder(1, { paidAt: at, updatedAt: at }); // aucune écriture charge
  listImpl = async () => ({ has_more: false, data: [{ id: 'txn_1', amount: 2000, fee: 0, currency: 'eur', reporting_category: 'charge' }] });
  const snapshot = JSON.stringify([...store.values()]);

  const res = await cron(`Bearer ${CRON_SECRET}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'mismatch');
  assert.equal(res.body.discrepancies, 2);
  assert.ok(!('orderId' in res.body) && !JSON.stringify(res.body).includes(oid(1)));
  const kinds = reports[0].update.$set.discrepancies.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['charge_missing', 'stripe_total_mismatch']);
  assert.equal(JSON.stringify([...store.values()]), snapshot);
  assert.equal(double.entries.length, 0, 'le rapprochement n\'écrit aucune écriture de ledger');
});

test('cron : Stripe indisponible ou incomplet -> rapport « mismatch » avec le motif, réponse 200', async () => {
  listImpl = async () => { throw Object.assign(new Error('boom'), { type: 'StripeConnectionError' }); };
  let res = await cron(`Bearer ${CRON_SECRET}`);
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.status, res.body.stripeComplete], ['mismatch', false]);
  assert.deepEqual(reports[0].update.$set.discrepancies, [{ kind: 'stripe_unavailable' }]);

  reports.length = 0;
  listImpl = async () => ({ has_more: true, data: [{ id: 't', amount: 1, currency: 'eur', type: 'charge' }] });
  res = await cron(`Bearer ${CRON_SECRET}`);
  assert.equal(res.body.stripeComplete, false);
  assert.ok(reports[0].update.$set.discrepancies.some((d) => d.kind === 'stripe_fetch_incomplete'));
});

test('cron : une panne de stockage du rapport donne 500 sans détail', async () => {
  const original = LedgerReconciliationReport.findOneAndUpdate;
  const leak = crypto.randomBytes(12).toString('hex');
  LedgerReconciliationReport.findOneAndUpdate = async () => { throw new Error(`stockage ${leak}`); };
  const res = await cron(`Bearer ${CRON_SECRET}`);
  LedgerReconciliationReport.findOneAndUpdate = original;
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes(leak));
  assert.ok(!JSON.stringify(console.error.mock.calls.map((c) => c.arguments)).includes(leak));
});

// --- Routes : limiteur déclaré sur la route elle-même ------------------------------------------

const isLimiter = (layer) => typeof layer.handle.resetKey === 'function' && typeof layer.handle.getKey === 'function';

test('route admin GET /ledger/summary : limiteur sur la route, puis protect, rôle admin et gestionnaire', () => {
  const router = require('../routes/adminRoutes');
  const layer = router.stack.find((l) => l.route?.path === '/ledger/summary');
  assert.ok(layer, 'route absente');
  assert.equal(layer.route.methods.get, true);
  const stack = layer.route.stack;
  assert.equal(stack.length, 4);
  assert.ok(isLimiter(stack[0]), 'le limiteur doit être déclaré sur la route');
  assert.equal(stack[1].handle.name, 'protect');
  assert.equal(stack[3].handle, getLedgerSummary);
});

test('route cron POST /ledger/reconcile-daily : limiteur sur la route, gestionnaire cron, sans session utilisateur', () => {
  const { router } = require('../routes/paymentRoutes');
  const layer = router.stack.find((l) => l.route?.path === '/ledger/reconcile-daily');
  assert.ok(layer, 'route absente');
  assert.equal(layer.route.methods.post, true);
  assert.equal(layer.route.stack.length, 2);
  assert.ok(isLimiter(layer.route.stack[0]));
  assert.equal(layer.route.stack[1].handle, reconcileDailyCron);
  assert.ok(!layer.route.stack.some((l) => l.handle.name === 'protect'));
});
