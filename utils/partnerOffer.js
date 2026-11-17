'use strict';

/**
 * Offre AFROEAT pour les partenaires — pensée pour une plateforme qui démarre sans trésorerie :
 * AFROEAT ne verse jamais plus que ce que le client a payé.
 *
 * - Restaurant livré par AFROEAT : commission standard (MARKETPLACE_RATES_JSON, 15 %).
 * - Restaurant qui livre lui-même : 8 % seulement (il garde 100 % des frais de livraison).
 * - Premier mois (30 jours après l'ouverture de la fiche) : 0 % de commission AFROEAT,
 *   seuls 2,5 % de frais de paiement sont retenus (frais bancaires Stripe).
 * - Livreur : minimum garanti par course (3,50 € / 4 CHF). Les frais de livraison payés par le
 *   client ne descendent jamais sous ce minimum, et la part du livreur est relevée jusqu'au minimum
 *   sur la part plateforme des frais de livraison — jamais au-delà des frais encaissés.
 */
const SELF_DELIVERY_COMMISSION_BPS = 800;
const FIRST_MONTH_FEE_BPS = 250;
const FIRST_MONTH_DAYS = 30;
const COURIER_MINIMUM = { EUR: 3.5, CHF: 4 };

const DAY_MS = 24 * 60 * 60 * 1000;

const isInFirstMonth = (restaurant, now = Date.now()) => {
  const start = restaurant?.createdAt ? new Date(restaurant.createdAt).getTime() : NaN;
  return Number.isFinite(start) && now - start >= 0 && now - start < FIRST_MONTH_DAYS * DAY_MS;
};

/** Commission appliquée à ce restaurant (en points de base), jamais au-dessus du taux configuré. */
const resolveCommissionBps = (baseBps, restaurant, now = Date.now()) => {
  const base = Number.isInteger(baseBps) ? baseBps : 0;
  if (isInFirstMonth(restaurant, now)) return Math.min(base, FIRST_MONTH_FEE_BPS);
  if (restaurant?.selfDelivery === true) return Math.min(base, SELF_DELIVERY_COMMISSION_BPS);
  return base;
};

/** Taux effectifs pour ce restaurant à partir des taux configurés pour la devise. */
const ratesForRestaurant = (rates, restaurant, now = Date.now()) => {
  if (!rates) return rates;
  return { ...rates, commissionBps: resolveCommissionBps(rates.commissionBps, restaurant, now) };
};

const courierMinimumFor = (currency) => COURIER_MINIMUM[String(currency || '').toUpperCase()] || 0;

/** Frais de livraison facturés : jamais sous le minimum livreur quand AFROEAT livre. */
const floorDeliveryFee = (fee, currency, selfDelivery) => {
  const value = Number(fee) || 0;
  if (selfDelivery) return value;
  return Math.max(value, courierMinimumFor(currency));
};

const offerSummary = () => ({
  selfDeliveryCommissionPercent: SELF_DELIVERY_COMMISSION_BPS / 100,
  firstMonth: { days: FIRST_MONTH_DAYS, commissionPercent: 0, paymentFeePercent: FIRST_MONTH_FEE_BPS / 100 },
  courierMinimumPerDelivery: { ...COURIER_MINIMUM },
  tipsToCourierPercent: 100,
});

module.exports = {
  SELF_DELIVERY_COMMISSION_BPS,
  FIRST_MONTH_FEE_BPS,
  FIRST_MONTH_DAYS,
  COURIER_MINIMUM,
  isInFirstMonth,
  resolveCommissionBps,
  ratesForRestaurant,
  courierMinimumFor,
  floorDeliveryFee,
  offerSummary,
};
