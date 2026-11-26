'use strict';

// Écriture dans le ledger (models/LedgerEntry.js) : IDEMPOTENTE et À ÉCHEC OUVERT.
// Une panne, un timeout ou une donnée invalide du ledger ne doit JAMAIS casser ni bloquer un paiement, un
// remboursement ou un versement : toutes les fonctions exportées ici ne lèvent jamais, journalisent un
// code d'erreur sans donnée sensible (ni montant, ni identifiant client, ni message brut) et rendent la main.

const mongoose = require('mongoose');
const { normalizeCurrency, toMinorUnits } = require('./currency');
const { LEDGER_TYPES, LEDGER_PARTIES, isCurrencyCode, isValidMeta } = require('../models/LedgerEntry');

const DEFAULT_TIMEOUT_MS = 2500;
const FEE_LOOKUP_TIMEOUT_MS = 4000;

// Points d'injection (tests) : le ledger n'est écrit que si la connexion MongoDB est prête, ce qui évite
// d'attendre le tampon de commandes de Mongoose quand la base est indisponible.
const runtime = {
  isReady: () => mongoose.connection.readyState === 1,
  getModel: () => require('../models/LedgerEntry'),
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error('ledger timeout');
    error.code = 'LEDGER_TIMEOUT';
    reject(error);
  }, ms);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); }
  );
});

const logLedgerError = (stage, entryType, error) => {
  // Volontairement minimal : pas de message brut (peut citer des valeurs), pas de montant ni d'identifiant.
  console.error('LEDGER ERROR =>', {
    stage,
    entryType: entryType || undefined,
    name: error?.name,
    code: error?.code,
  });
};

const sanitizeMeta = (meta) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const clean = {};
  let count = 0;
  for (const key of Object.keys(meta)) {
    if (count >= 10) break;
    const value = meta[key];
    if (typeof value === 'string') clean[key] = value.slice(0, 100);
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean') clean[key] = value;
    else continue;
    count += 1;
  }
  return isValidMeta(clean) && count > 0 ? clean : null;
};

// Valide et normalise une écriture ; lève une Error (interceptée par recordEntry) si elle est invalide.
const normalizeEntry = (entry) => {
  if (!entry || typeof entry !== 'object') throw new Error('entry');
  if (!LEDGER_TYPES.includes(entry.type)) throw new Error('type');
  if (!LEDGER_PARTIES.includes(entry.party)) throw new Error('party');
  const currency = normalizeCurrency(entry.currency);
  if (!isCurrencyCode(currency)) throw new Error('currency');
  if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor === 0) throw new Error('amountMinor');
  const idempotencyKey = String(entry.idempotencyKey || '').trim();
  if (idempotencyKey.length < 3 || idempotencyKey.length > 200) throw new Error('idempotencyKey');
  const occurredAt = entry.occurredAt instanceof Date ? entry.occurredAt : new Date(entry.occurredAt || Date.now());
  if (Number.isNaN(occurredAt.getTime())) throw new Error('occurredAt');
  const orderId = entry.order ? String(entry.order) : null;
  if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) throw new Error('order');
  const stripeObjectId = entry.stripeObjectId ? String(entry.stripeObjectId).trim().slice(0, 120) : null;

  return {
    type: entry.type,
    order: orderId,
    currency,
    amountMinor: entry.amountMinor,
    party: entry.party,
    stripeObjectId: stripeObjectId || null,
    idempotencyKey,
    occurredAt,
    meta: sanitizeMeta(entry.meta),
  };
};

/**
 * Enregistre une écriture de façon idempotente. Ne lève jamais.
 * @returns {Promise<{ status: 'recorded' | 'duplicate' | 'skipped' | 'error' }>}
 */
const recordEntry = async (entry, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  let normalized;
  try {
    normalized = normalizeEntry(entry);
  } catch (error) {
    logLedgerError('validate', entry?.type, error);
    return { status: 'error' };
  }

  try {
    if (!runtime.isReady()) return { status: 'skipped' };
    const Model = runtime.getModel();
    const status = await withTimeout((async () => {
      const existing = await Model.findOne({ idempotencyKey: normalized.idempotencyKey }).select('_id').lean();
      if (existing) return 'duplicate';
      try {
        await Model.create(normalized);
        return 'recorded';
      } catch (error) {
        // Course entre deux rejeux : l'index unique tranche, l'écriture existe déjà.
        if (error?.code === 11000) return 'duplicate';
        throw error;
      }
    })(), timeoutMs);
    return { status };
  } catch (error) {
    logLedgerError('write', normalized.type, error);
    return { status: 'error' };
  }
};

// ---------------------------------------------------------------------------------------------
// Constructeurs d'écritures (purs : retournent une écriture ou null, ne touchent ni base ni réseau).
// Partagés par les chemins en direct et par le script de backfill pour garder les MÊMES clés.
// ---------------------------------------------------------------------------------------------

const unixToDate = (seconds) => (Number(seconds) > 0 ? new Date(Number(seconds) * 1000) : new Date());

const asDate = (value, fallback = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};
const fromUnixSeconds = (seconds) => (Number.isFinite(Number(seconds)) && Number(seconds) > 0
  ? new Date(Number(seconds) * 1000)
  : new Date());
const orderIdOf = (order) => String(order?._id || order?.id || '');
const intentIdOf = (order) => String(order?.stripePaymentIntentId || '') || null;

const orderTotalMinor = (order) => toMinorUnits(order?.totalPrice, order?.currency);

const earningMinor = (order, kind) => toMinorUnits(
  kind === 'restaurant' ? order?.restaurantEarning : order?.driverEarning,
  order?.currency
);

const buildChargeEntry = (order, { paymentIntentId } = {}) => {
  const amountMinor = orderTotalMinor(order);
  if (!orderIdOf(order) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    type: 'charge', order: orderIdOf(order), currency: order.currency, amountMinor, party: 'customer',
    stripeObjectId: paymentIntentId || intentIdOf(order),
    idempotencyKey: `charge:order:${orderIdOf(order)}`,
    occurredAt: asDate(order.paidAt),
    meta: { method: String(order.paymentMethod || '') },
  };
};

const buildRefundEntry = (order, refund) => {
  if (!refund?.id || !orderIdOf(order)) return null;
  const currency = refund.currency || order?.currency;
  const amountMinor = Number(refund.amount);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    type: 'refund', order: orderIdOf(order), currency, amountMinor: -amountMinor, party: 'customer',
    stripeObjectId: refund.id,
    idempotencyKey: `refund:${refund.id}`,
    occurredAt: fromUnixSeconds(refund.created),
    meta: refund.reason ? { reason: String(refund.reason) } : null,
  };
};

const buildTransferEntry = (order, kind, transferId, { amountMinor, occurredAt } = {}) => {
  const amount = Number.isSafeInteger(amountMinor) ? amountMinor : earningMinor(order, kind);
  if (!transferId || !orderIdOf(order) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    type: 'transfer', order: orderIdOf(order), currency: order.currency, amountMinor: -amount, party: kind,
    stripeObjectId: String(transferId),
    idempotencyKey: `transfer:${transferId}`,
    occurredAt: asDate(occurredAt),
    meta: null,
  };
};

const buildTransferReversalEntry = (order, kind, reversalId, { amountMinor, occurredAt } = {}) => {
  const amount = Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : earningMinor(order, kind);
  if (!reversalId || !orderIdOf(order) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    type: 'transfer_reversal', order: orderIdOf(order), currency: order.currency, amountMinor: amount, party: kind,
    stripeObjectId: String(reversalId),
    idempotencyKey: `transfer_reversal:${reversalId}`,
    occurredAt: asDate(occurredAt),
    meta: null,
  };
};

const buildDisputeLostEntry = (order, dispute) => {
  const amountMinor = Number(dispute?.amount);
  if (!dispute?.id || !orderIdOf(order) || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return {
    type: 'dispute_lost', order: orderIdOf(order), currency: dispute.currency || order.currency,
    amountMinor: -amountMinor, party: 'customer',
    stripeObjectId: dispute.id,
    idempotencyKey: `dispute_lost:${dispute.id}`,
    occurredAt: new Date(),
    meta: dispute.reason ? { reason: String(dispute.reason) } : null,
  };
};

// Espèces : mêmes règles que le registre admin (controllers/cashLedgerController.js).
//  - le restaurant encaisse (livraison par lui ou retrait) : il doit sa commission à la plateforme ;
//  - un livreur encaisse : il doit total - sa part - pourboire.
const cashHolder = (order) => (order?.selfDelivery === true || order?.fulfillment === 'pickup' ? 'restaurant' : 'courier');
const cashDueMinor = (order) => {
  if (cashHolder(order) === 'restaurant') return toMinorUnits(order.platformCommissionAmount, order.currency);
  const due = Math.max(0, Number(order.totalPrice || 0) - Number(order.driverEarning || 0) - Number(order.tipAmount || 0));
  return toMinorUnits(due, order.currency);
};

const buildCashEntry = (order, type) => {
  if (order?.paymentMethod !== 'cash' || !orderIdOf(order)) return null;
  // Comme le registre admin : seules les commandes dont la commission espèces est due (ou soldée) comptent.
  if (!['due', 'settled'].includes(order.cashCommissionStatus)) return null;
  const due = cashDueMinor(order);
  if (!Number.isSafeInteger(due) || due <= 0) return null;
  const collected = type === 'cash_collected';
  return {
    type, order: orderIdOf(order), currency: order.currency, amountMinor: collected ? due : -due,
    party: cashHolder(order), stripeObjectId: null,
    idempotencyKey: `${type}:${orderIdOf(order)}`,
    occurredAt: asDate(collected ? order.deliveredAt : order.cashCommissionSettledAt),
    meta: null,
  };
};

// ---------------------------------------------------------------------------------------------
// Points d'accroche (tous sans levée d'exception).
// ---------------------------------------------------------------------------------------------

const safeBuildAndRecord = async (build, stage) => {
  try {
    const entry = build();
    if (!entry) return { status: 'skipped' };
    return await recordEntry(entry);
  } catch (error) {
    logLedgerError(stage, undefined, error);
    return { status: 'error' };
  }
};

const recordCharge = (order, details) => safeBuildAndRecord(() => buildChargeEntry(order, details), 'charge');
const recordRefund = (order, refund) => safeBuildAndRecord(() => buildRefundEntry(order, refund), 'refund');
const recordTransfer = (order, kind, transferId, details) =>
  safeBuildAndRecord(() => buildTransferEntry(order, kind, transferId, details), 'transfer');
const recordTransferReversal = (order, kind, reversalId, details) =>
  safeBuildAndRecord(() => buildTransferReversalEntry(order, kind, reversalId, details), 'transfer_reversal');
const recordDisputeLost = (order, dispute) => safeBuildAndRecord(() => buildDisputeLostEntry(order, dispute), 'dispute_lost');
const recordCashCollected = (order) => safeBuildAndRecord(() => buildCashEntry(order, 'cash_collected'), 'cash_collected');
const recordCashSettled = (order) => safeBuildAndRecord(() => buildCashEntry(order, 'cash_settled'), 'cash_settled');

// Plusieurs remboursements d'une même charge (webhook charge.refunded) : un par remboursement Stripe abouti.
const recordRefunds = async (order, refunds) => {
  const results = [];
  for (const refund of Array.isArray(refunds) ? refunds : []) {
    if (refund?.status && refund.status !== 'succeeded') continue;
    results.push(await recordRefund(order, refund));
  }
  return results;
};

// Frais Stripe : BEST-EFFORT. Lit le balance_transaction de la charge (déjà inclus dans le PaymentIntent
// s'il a été développé, sinon un appel borné dans le temps). Indisponible = aucune écriture, aucune erreur.
const extractBalanceTransaction = (paymentIntent) => {
  const charge = paymentIntent?.latest_charge;
  const bt = charge && typeof charge === 'object' ? charge.balance_transaction : null;
  return bt && typeof bt === 'object' ? bt : null;
};

const recordStripeFee = async (order, { stripe, paymentIntent, paymentIntentId, timeoutMs = FEE_LOOKUP_TIMEOUT_MS } = {}) => {
  try {
    const orderId = orderIdOf(order);
    if (!orderId || !runtime.isReady()) return { status: 'skipped' };
    const key = `stripe_fee:order:${orderId}`;

    // Court-circuit : évite tout appel Stripe quand les frais sont déjà enregistrés (rejeu de webhook).
    const existing = await withTimeout(
      runtime.getModel().findOne({ idempotencyKey: key }).select('_id').lean(),
      DEFAULT_TIMEOUT_MS
    );
    if (existing) return { status: 'duplicate' };

    let bt = extractBalanceTransaction(paymentIntent);
    const intentId = paymentIntentId || paymentIntent?.id || intentIdOf(order);
    if (!bt && intentId && typeof stripe?.paymentIntents?.retrieve === 'function') {
      const expanded = await withTimeout(
        stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge.balance_transaction'] }),
        timeoutMs
      );
      bt = extractBalanceTransaction(expanded);
    }
    const fee = Number(bt?.fee);
    if (!bt || !Number.isSafeInteger(fee) || fee <= 0) return { status: 'skipped' };

    return await recordEntry({
      type: 'stripe_fee', order: orderId, currency: bt.currency, amountMinor: -fee, party: 'platform',
      stripeObjectId: bt.id || null, idempotencyKey: key, occurredAt: asDate(order.paidAt),
      meta: { net: Number.isSafeInteger(Number(bt.net)) ? Number(bt.net) : undefined },
    });
  } catch (error) {
    logLedgerError('stripe_fee', 'stripe_fee', error);
    return { status: 'skipped' };
  }
};

// ---------------------------------------------------------------------------------------------
// Lecture : totaux par type et par devise sur [from, to).
// ---------------------------------------------------------------------------------------------

const summarizeLedger = async ({ from, to }, { model } = {}) => {
  const Model = model || runtime.getModel();
  const rows = await Model.aggregate(
    [
      { $match: { occurredAt: { $gte: from, $lt: to } } },
      { $group: { _id: { type: '$type', currency: '$currency' }, count: { $sum: 1 }, totalMinor: { $sum: '$amountMinor' } } },
    ],
    { maxTimeMS: 15000 }
  );
  return rows
    .map((row) => ({ type: row._id.type, currency: row._id.currency, count: row.count, totalMinor: row.totalMinor }))
    .sort((a, b) => (a.currency === b.currency ? a.type.localeCompare(b.type) : a.currency.localeCompare(b.currency)));
};

module.exports = {
  recordEntry,
  recordCharge,
  recordStripeFee,
  recordRefund,
  recordRefunds,
  recordTransfer,
  recordTransferReversal,
  recordDisputeLost,
  recordCashCollected,
  recordCashSettled,
  summarizeLedger,
  buildChargeEntry,
  buildRefundEntry,
  buildTransferEntry,
  buildTransferReversalEntry,
  buildDisputeLostEntry,
  buildCashEntry,
  normalizeEntry,
  unixToDate,
  withTimeout,
  runtime,
};
