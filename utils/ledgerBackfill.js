'use strict';

// Reconstruction des écritures charge / refund / transfer / transfer_reversal des commandes passées.
// Utilise les MÊMES constructeurs et les MÊMES clés d'idempotence que les chemins en direct (utils/ledger.js) :
// relancer le backfill, ou le lancer après que le direct a déjà écrit, ne duplique rien.
// Par défaut SIMULATION : n'écrit que si `apply` est vrai. Ne contacte jamais Stripe (donc aucun frais Stripe).

const Order = require('../models/Order');
const LedgerEntry = require('../models/LedgerEntry');
const { toMinorUnits } = require('./currency');
const {
  recordEntry,
  buildChargeEntry,
  buildRefundEntry,
  buildTransferEntry,
  buildTransferReversalEntry,
} = require('./ledger');

const FIELDS = [
  '_id', 'totalPrice', 'currency', 'paymentMethod', 'paymentStatus', 'paidAt', 'createdAt', 'updatedAt', 'refundedAt',
  'stripePaymentIntentId', 'stripeRefundId', 'stripeAmountRefunded', 'payoutUpdatedAt',
  'restaurantEarning', 'driverEarning',
  'stripeRestaurantTransferId', 'stripeCourierTransferId', 'stripeRestaurantReversalId', 'stripeCourierReversalId',
].join(' ');

const ENTRY_TYPES = ['charge', 'refund', 'transfer', 'transfer_reversal'];

// Garde de base de données (comme scripts/promote-admin.js) : EXPECT_DB, sinon la base de staging.
const DEFAULT_EXPECTED_DB = 'afroeat_staging';
const isExpectedDatabase = (actualName, env = process.env) =>
  String(actualName || '') === String(env.EXPECT_DB || DEFAULT_EXPECTED_DB);

// `--apply` écrit ; `--dry-run` (défaut) simule ; les deux ensemble sont refusés.
const parseArgs = (argv) => {
  const args = new Set(argv);
  const apply = args.has('--apply');
  if (apply && args.has('--dry-run')) return { error: 'Choisir soit --dry-run soit --apply.' };
  const unknown = argv.filter((arg) => !['--apply', '--dry-run'].includes(arg));
  if (unknown.length) return { error: 'Option inconnue.' };
  return { apply, dryRun: !apply };
};

const secondsOf = (value) => (value ? Math.floor(new Date(value).getTime() / 1000) : undefined);

// Écritures reconstructibles d'une commande (lean). Les remboursements ne sont reconstruits que s'ils sont
// identifiables (stripeRefundId) ; le montant est le cumul connu de la commande.
const buildOrderEntries = (order, { skipRefund = false } = {}) => {
  const entries = [];
  const paidOrder = { ...order, paidAt: order.paidAt || order.createdAt };
  entries.push(buildChargeEntry(paidOrder));

  if (!skipRefund && order.stripeRefundId) {
    const recorded = Number(order.stripeAmountRefunded || 0);
    const amount = recorded > 0 ? toMinorUnits(recorded, order.currency)
      : (order.refundedAt ? toMinorUnits(order.totalPrice, order.currency) : 0);
    entries.push(buildRefundEntry(order, {
      id: order.stripeRefundId, amount, currency: order.currency, created: secondsOf(order.refundedAt || order.updatedAt),
    }));
  }

  const occurredAt = order.payoutUpdatedAt || order.paidAt || order.createdAt;
  for (const [kind, transferField, reversalField] of [
    ['restaurant', 'stripeRestaurantTransferId', 'stripeRestaurantReversalId'],
    ['courier', 'stripeCourierTransferId', 'stripeCourierReversalId'],
  ]) {
    if (order[transferField]) entries.push(buildTransferEntry(order, kind, order[transferField], { occurredAt }));
    if (order[reversalField]) entries.push(buildTransferReversalEntry(order, kind, order[reversalField], { occurredAt }));
  }
  return entries.filter(Boolean).map((entry) => ({ ...entry, meta: { ...(entry.meta || {}), backfill: true } }));
};

/**
 * @returns {Promise<{ apply: boolean, ordersScanned: number, byType: Record<string, {planned:number, existing:number, recorded:number, errors:number}> }>}
 */
const backfillLedger = async ({
  apply = false,
  OrderModel = Order,
  LedgerModel = LedgerEntry,
  record = recordEntry,
  batchSize = 200,
  maxOrders = Infinity,
} = {}) => {
  const byType = Object.fromEntries(ENTRY_TYPES.map((type) => [type, { planned: 0, existing: 0, recorded: 0, errors: 0 }]));
  const filter = { paymentMethod: { $in: ['card', 'stripe_checkout'] }, paymentStatus: { $in: ['Payé', 'Remboursé'] } };
  let ordersScanned = 0;
  let lastId = null;

  while (ordersScanned < maxOrders) {
    const orders = await OrderModel.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
      .select(FIELDS).sort({ _id: 1 }).limit(Math.min(batchSize, maxOrders - ordersScanned)).lean();
    if (!orders.length) break;
    lastId = orders[orders.length - 1]._id;
    ordersScanned += orders.length;

    // Un remboursement déjà écrit (en direct) pour la commande empêche toute reconstruction du cumul.
    const refunded = await LedgerModel.find({ order: { $in: orders.map((o) => o._id) }, type: 'refund' }).select('order').lean();
    const withRefund = new Set(refunded.map((entry) => String(entry.order)));
    const planned = orders.flatMap((order) => buildOrderEntries(order, { skipRefund: withRefund.has(String(order._id)) }));

    const existingKeys = new Set(
      (await LedgerModel.find({ idempotencyKey: { $in: planned.map((entry) => entry.idempotencyKey) } }).select('idempotencyKey').lean())
        .map((entry) => entry.idempotencyKey)
    );
    for (const entry of planned) {
      const stats = byType[entry.type];
      if (existingKeys.has(entry.idempotencyKey)) { stats.existing += 1; continue; }
      stats.planned += 1;
      if (!apply) continue;
      const result = await record(entry);
      if (result.status === 'recorded') stats.recorded += 1;
      else if (result.status === 'duplicate') { stats.planned -= 1; stats.existing += 1; }
      else stats.errors += 1;
    }
    if (orders.length < batchSize) break;
  }
  return { apply, ordersScanned, byType };
};

module.exports = { backfillLedger, buildOrderEntries, isExpectedDatabase, parseArgs, DEFAULT_EXPECTED_DB };
