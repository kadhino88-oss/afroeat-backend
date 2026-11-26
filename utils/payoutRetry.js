'use strict';

const Order = require('../models/Order');
const { isConnectPayoutsEnabled, reconcileOrderPayout } = require('./marketplacePayouts');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_BUDGET_MS = 25 * 1000;

const clampLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

// Commandes livrées dont le versement attend une relance. Exclut les litiges encore ouverts et les
// commandes sans répartition marketplace vérifiée (elles ne peuvent pas aboutir sans contrôle manuel).
// Tri : jamais tentées d'abord, puis tentative la plus ancienne ; une commande qui échoue est donc
// repoussée en fin de file et ne peut pas affamer les autres.
const buildRetryQuery = () => ({
  status: 'Livrée',
  payoutStatus: { $in: ['pending', 'reconciliation_required'] },
  marketplaceSplitCalculated: true,
  $or: [
    { stripeDisputeId: { $in: [null, ''] } },
    { stripeDisputeClosedAt: { $ne: null } },
  ],
});

/**
 * Relance, de façon bornée, les versements `pending` / `reconciliation_required`.
 * Réutilise `reconcileOrderPayout` : mêmes garde-fous et mêmes clés d'idempotence Stripe que la relance
 * manuelle, donc une double exécution ne peut pas créer de second transfert.
 * Ne renvoie que des compteurs (aucune donnée personnelle).
 */
const retryPendingPayouts = async ({
  limit = DEFAULT_LIMIT,
  budgetMs = DEFAULT_BUDGET_MS,
  reconcile = reconcileOrderPayout,
  OrderModel = Order,
  now = () => Date.now(),
} = {}) => {
  const counts = { retried: 0, succeeded: 0, failed: 0 };
  if (!isConnectPayoutsEnabled()) return { ...counts, skipped: 'connect_disabled' };

  const orders = await OrderModel.find(buildRetryQuery())
    .sort({ payoutUpdatedAt: 1, _id: 1 })
    .limit(clampLimit(limit))
    .select('_id')
    .lean();

  const deadline = now() + budgetMs;
  for (const { _id: orderId } of orders) {
    if (now() > deadline) break;
    counts.retried += 1;
    try {
      const result = await reconcile(orderId);
      if (result?.success) counts.succeeded += 1;
      else counts.failed += 1;
    } catch (error) {
      counts.failed += 1;
      console.error('PAYOUT RETRY ERROR =>', { orderId: String(orderId), code: error?.code, type: error?.type });
    }
  }
  return counts;
};

module.exports = { retryPendingPayouts, buildRetryQuery, clampLimit, DEFAULT_LIMIT, MAX_LIMIT };
