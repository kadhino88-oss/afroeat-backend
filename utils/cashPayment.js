'use strict';

/**
 * Paiement en espèces.
 * - Livraison par le restaurant ou retrait : le restaurant encaisse ; sa commission est due à la plateforme.
 * - Livraison par un livreur AFROEAT : le livreur encaisse, garde sa part et le pourboire, reverse le
 *   reste à la plateforme, qui règle ensuite le restaurant. Le montant est plafonné pour limiter le risque.
 */
const CASH_COURIER_MAX_TOTAL = (env = process.env) => {
  const value = Number(env.CASH_COURIER_MAX_TOTAL);
  return Number.isFinite(value) && value > 0 ? value : 60;
};

const isRestaurantCollected = (order) =>
  Boolean(order) && (order.selfDelivery === true || order.fulfillment === 'pickup');

const cashDecision = (order, env = process.env) => {
  if (!order) return { allowed: false, code: 'ORDER_REQUIRED' };
  if (isRestaurantCollected(order)) return { allowed: true, holder: 'restaurant' };
  const max = CASH_COURIER_MAX_TOTAL(env);
  if (Number(order.totalPrice || 0) > max) {
    return {
      allowed: false,
      code: 'CASH_LIMIT_EXCEEDED',
      message: `Le paiement en espèces à un livreur est limité à ${max} pour une commande. Payez par carte.`,
    };
  }
  return { allowed: true, holder: 'courier' };
};

const isCashAllowedForOrder = (order, env = process.env) => cashDecision(order, env).allowed;
const isCashEligibleOrder = isRestaurantCollected;

module.exports = { cashDecision, isCashAllowedForOrder, isCashEligibleOrder, CASH_COURIER_MAX_TOTAL };
