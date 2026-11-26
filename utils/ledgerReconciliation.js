'use strict';

// Rapprochement du ledger. LECTURE SEULE : rien n'est jamais corrigé automatiquement et aucun mouvement
// d'argent n'est déclenché. Les écarts sont listés pour qu'un humain les examine.
//
//  1. reconcileLedgerWithOrders : ledger contre les commandes (paiement sans écriture charge, remboursement
//     sans écriture, transfert / réversion sans écriture, montants différents, doublons sémantiques) ;
//  2. fetchStripeBalanceTotals + compareLedgerWithStripe : ledger contre les balance transactions Stripe.
//
// Toutes les périodes sont semi-ouvertes [from, to). Tous les parcours sont bornés (pagination par _id).

const Order = require('../models/Order');
const LedgerEntry = require('../models/LedgerEntry');
const { toMinorUnits, normalizeCurrency } = require('./currency');
const { summarizeLedger } = require('./ledger');

const ORDER_PAGE_SIZE = 500;
const MAX_ORDERS_SCANNED = 5000;
const LEDGER_PAGE_SIZE = 1000;
const MAX_LEDGER_SCANNED = 10000;
const MAX_DISCREPANCIES = 200;
const STRIPE_PAGE_SIZE = 100;
const MAX_STRIPE_PAGES = 50;

const ORDER_FIELDS = [
  '_id', 'totalPrice', 'currency', 'paymentMethod', 'paymentStatus', 'paidAt', 'refundedAt',
  'stripeAmountRefunded', 'payoutUpdatedAt', 'updatedAt', 'restaurantEarning', 'driverEarning',
  'stripeRestaurantTransferId', 'stripeCourierTransferId',
  'stripeRestaurantReversalId', 'stripeCourierReversalId',
].join(' ');

const addTo = (bucket, currency, amount) => {
  const key = normalizeCurrency(currency);
  bucket[key] = (bucket[key] || 0) + amount;
};

/**
 * Ledger contre commandes sur [from, to).
 * @returns {Promise<{ discrepancies: object[], counts: object, ordersScanned: number, ledgerEntriesScanned: number,
 *   truncated: boolean, ledgerTotals: object[], orderTotals: object }>}
 */
const reconcileLedgerWithOrders = async ({ from, to }, { OrderModel = Order, LedgerModel = LedgerEntry } = {}) => {
  const discrepancies = [];
  const counts = {};
  let truncated = false;
  let ordersScanned = 0;
  const orderTotals = { charge: {}, refund: {}, transfer: {} };

  const flag = (kind, details) => {
    counts[kind] = (counts[kind] || 0) + 1;
    if (discrepancies.length < MAX_DISCREPANCIES) discrepancies.push({ kind, ...details });
    else truncated = true;
  };

  // Parcourt les commandes d'un filtre par pages (_id croissant), dans la limite globale MAX_ORDERS_SCANNED.
  const scan = async (filter, ledgerTypes, handler, seen = new Set()) => {
    let lastId = null;
    for (;;) {
      if (ordersScanned >= MAX_ORDERS_SCANNED) { truncated = true; return; }
      const query = lastId ? { ...filter, _id: { $gt: lastId } } : filter;
      const orders = await OrderModel.find(query).select(ORDER_FIELDS).sort({ _id: 1 }).limit(ORDER_PAGE_SIZE).lean();
      if (!orders.length) return;
      lastId = orders[orders.length - 1]._id;

      const fresh = orders.filter((order) => !seen.has(String(order._id)));
      fresh.forEach((order) => seen.add(String(order._id)));
      ordersScanned += fresh.length;

      const entries = fresh.length
        ? await LedgerModel.find({ order: { $in: fresh.map((order) => order._id) }, type: { $in: ledgerTypes } })
          .select('order type amountMinor stripeObjectId').lean()
        : [];
      const byOrder = new Map();
      for (const entry of entries) {
        const key = String(entry.order);
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key).push(entry);
      }
      for (const order of fresh) handler(order, byOrder.get(String(order._id)) || []);
      if (orders.length < ORDER_PAGE_SIZE) return;
    }
  };

  const inPeriod = { $gte: from, $lt: to };

  // 1. Paiements carte confirmés dans la période : exactement une écriture charge du bon montant.
  await scan(
    { paidAt: inPeriod, paymentMethod: { $in: ['card', 'stripe_checkout'] }, paymentStatus: { $in: ['Payé', 'Remboursé'] } },
    ['charge'],
    (order, entries) => {
      const expected = toMinorUnits(order.totalPrice, order.currency);
      if (Number.isSafeInteger(expected)) addTo(orderTotals.charge, order.currency, expected);
      const charges = entries.filter((entry) => entry.type === 'charge');
      const orderId = String(order._id);
      if (!charges.length) flag('charge_missing', { orderId, currency: normalizeCurrency(order.currency), expectedMinor: expected });
      else if (charges.length > 1) flag('charge_duplicate', { orderId, count: charges.length });
      else if (charges[0].amountMinor !== expected) {
        flag('charge_amount_mismatch', { orderId, currency: normalizeCurrency(order.currency), expectedMinor: expected, ledgerMinor: charges[0].amountMinor });
      }
    }
  );

  // 2. Remboursements : somme des écritures refund de la commande = montant remboursé enregistré.
  const refundHandler = (order, entries) => {
    const recorded = Number(order.stripeAmountRefunded || 0);
    let expected = recorded > 0 ? toMinorUnits(recorded, order.currency) : null;
    if (expected === null && order.paymentStatus === 'Remboursé') expected = toMinorUnits(order.totalPrice, order.currency);
    if (!Number.isSafeInteger(expected) || expected <= 0) return;
    addTo(orderTotals.refund, order.currency, -expected);
    const ledgerSum = -entries.filter((entry) => entry.type === 'refund').reduce((sum, entry) => sum + entry.amountMinor, 0);
    const orderId = String(order._id);
    const currency = normalizeCurrency(order.currency);
    if (ledgerSum === 0) flag('refund_missing', { orderId, currency, expectedMinor: expected });
    else if (ledgerSum !== expected) flag('refund_amount_mismatch', { orderId, currency, expectedMinor: expected, ledgerMinor: ledgerSum });
  };
  const seenRefunds = new Set();
  await scan({ refundedAt: inPeriod }, ['refund'], refundHandler, seenRefunds);
  // Remboursements partiels : pas de refundedAt, on se rabat sur la dernière mise à jour de la commande.
  await scan({ stripeAmountRefunded: { $gt: 0 }, refundedAt: null, updatedAt: inPeriod }, ['refund'], refundHandler, seenRefunds);

  // 3. Transferts et réversions Connect : une écriture par identifiant Stripe, du bon montant.
  await scan({ payoutUpdatedAt: inPeriod }, ['transfer', 'transfer_reversal'], (order, entries) => {
    const orderId = String(order._id);
    const currency = normalizeCurrency(order.currency);
    for (const [kind, transferField, reversalField] of [
      ['restaurant', 'stripeRestaurantTransferId', 'stripeRestaurantReversalId'],
      ['courier', 'stripeCourierTransferId', 'stripeCourierReversalId'],
    ]) {
      const expected = toMinorUnits(kind === 'restaurant' ? order.restaurantEarning : order.driverEarning, order.currency);
      if (order[transferField]) {
        if (Number.isSafeInteger(expected)) addTo(orderTotals.transfer, order.currency, -expected);
        const found = entries.find((entry) => entry.type === 'transfer' && entry.stripeObjectId === order[transferField]);
        if (!found) flag('transfer_missing', { orderId, currency, party: kind, expectedMinor: expected });
        else if (Number.isSafeInteger(expected) && found.amountMinor !== -expected) {
          flag('transfer_amount_mismatch', { orderId, currency, party: kind, expectedMinor: -expected, ledgerMinor: found.amountMinor });
        }
      }
      if (order[reversalField]) {
        const found = entries.find((entry) => entry.type === 'transfer_reversal' && entry.stripeObjectId === order[reversalField]);
        if (!found) flag('transfer_reversal_missing', { orderId, currency, party: kind, expectedMinor: expected });
      }
    }
  });

  // 4. Doublons sémantiques : même (type, objet Stripe) sous deux clés d'idempotence différentes.
  let ledgerEntriesScanned = 0;
  {
    const groups = new Map();
    let lastId = null;
    for (;;) {
      if (ledgerEntriesScanned >= MAX_LEDGER_SCANNED) { truncated = true; break; }
      const base = { occurredAt: inPeriod, stripeObjectId: { $ne: null } };
      const page = await LedgerModel.find(lastId ? { ...base, _id: { $gt: lastId } } : base)
        .select('type stripeObjectId').sort({ _id: 1 }).limit(LEDGER_PAGE_SIZE).lean();
      if (!page.length) break;
      lastId = page[page.length - 1]._id;
      ledgerEntriesScanned += page.length;
      for (const entry of page) {
        const key = `${entry.type}|${entry.stripeObjectId}`;
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      if (page.length < LEDGER_PAGE_SIZE) break;
    }
    for (const [key, count] of groups) {
      if (count > 1) {
        const [type, ...rest] = key.split('|');
        flag('ledger_duplicate', { type, stripeObjectId: rest.join('|'), count });
      }
    }
  }

  const ledgerTotals = await summarizeLedger({ from, to }, { model: LedgerModel });
  return { discrepancies, counts, ordersScanned, ledgerEntriesScanned, truncated, ledgerTotals, orderTotals };
};

// ---------------------------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------------------------

// Correspondance balance transaction Stripe -> type de ledger (catégorie de reporting d'abord, puis `type`).
// À VALIDER avec des données réelles en mode test avant de s'y fier : les clés non reconnues ne sont pas
// comparées, elles sont rapportées dans `unmapped`.
const STRIPE_TO_LEDGER_TYPE = Object.freeze({
  charge: 'charge',
  payment: 'charge',
  refund: 'refund',
  payment_refund: 'refund',
  transfer: 'transfer',
  transfer_reversal: 'transfer_reversal',
  transfer_refund: 'transfer_reversal',
  dispute: 'dispute_lost',
});
const COMPARED_TYPES = ['charge', 'stripe_fee', 'refund', 'transfer', 'transfer_reversal', 'dispute_lost'];

/**
 * Totaux des balance transactions Stripe sur [from, to), pagination bornée.
 * @returns {Promise<{ totals: object[], unmapped: object[], transactions: number, complete: boolean }>}
 */
const fetchStripeBalanceTotals = async ({ stripe, from, to }, { pageSize = STRIPE_PAGE_SIZE, maxPages = MAX_STRIPE_PAGES } = {}) => {
  const mapped = new Map();
  const unmapped = new Map();
  const bump = (map, key, currency, amount) => {
    const mapKey = `${key}|${currency}`;
    const row = map.get(mapKey) || { type: key, currency, count: 0, totalMinor: 0 };
    row.count += 1;
    row.totalMinor += amount;
    map.set(mapKey, row);
  };

  let transactions = 0;
  let startingAfter = null;
  let complete = false;
  for (let page = 0; page < maxPages; page += 1) {
    const params = {
      created: { gte: Math.floor(from.getTime() / 1000), lt: Math.floor(to.getTime() / 1000) },
      limit: pageSize,
    };
    if (startingAfter) params.starting_after = startingAfter;
    const result = await stripe.balanceTransactions.list(params);
    const data = Array.isArray(result?.data) ? result.data : [];
    for (const bt of data) {
      transactions += 1;
      const currency = normalizeCurrency(bt.currency);
      const amount = Number(bt.amount);
      if (!Number.isSafeInteger(amount)) continue;
      const ledgerType = STRIPE_TO_LEDGER_TYPE[bt.reporting_category] || STRIPE_TO_LEDGER_TYPE[bt.type] || null;
      if (ledgerType) {
        bump(mapped, ledgerType, currency, amount);
        const fee = Number(bt.fee);
        if (ledgerType === 'charge' && Number.isSafeInteger(fee) && fee > 0) bump(mapped, 'stripe_fee', currency, -fee);
      } else {
        bump(unmapped, String(bt.reporting_category || bt.type || 'unknown').slice(0, 60), currency, amount);
      }
    }
    if (!result?.has_more || !data.length) { complete = true; break; }
    startingAfter = data[data.length - 1].id;
  }
  return { totals: [...mapped.values()], unmapped: [...unmapped.values()], transactions, complete };
};

// Écarts par (type, devise) entre le ledger et Stripe. Seuls les types comparables sont examinés.
const compareLedgerWithStripe = (ledgerTotals, stripeTotals) => {
  const key = (row) => `${row.type}|${row.currency}`;
  const ledgerByKey = new Map(ledgerTotals.filter((row) => COMPARED_TYPES.includes(row.type)).map((row) => [key(row), row]));
  const stripeByKey = new Map(stripeTotals.map((row) => [key(row), row]));
  const mismatches = [];
  for (const k of new Set([...ledgerByKey.keys(), ...stripeByKey.keys()])) {
    const ledgerMinor = ledgerByKey.get(k)?.totalMinor || 0;
    const stripeMinor = stripeByKey.get(k)?.totalMinor || 0;
    if (ledgerMinor !== stripeMinor) {
      const [type, currency] = k.split('|');
      mismatches.push({ kind: 'stripe_total_mismatch', type, currency, ledgerMinor, stripeMinor, diffMinor: ledgerMinor - stripeMinor });
    }
  }
  return mismatches;
};

module.exports = {
  reconcileLedgerWithOrders,
  fetchStripeBalanceTotals,
  compareLedgerWithStripe,
  STRIPE_TO_LEDGER_TYPE,
  MAX_DISCREPANCIES,
  MAX_ORDERS_SCANNED,
};
