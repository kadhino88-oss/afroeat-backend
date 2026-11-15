'use strict';

// Codes promo : la remise est financée par la plateforme, jamais par le restaurant ni le livreur.
// Elle est plafonnée à une part de la marge de la plateforme pour ne jamais vendre à perte.

const PROMO_TYPES = ['percent', 'fixed'];
const PLATFORM_MARGIN_SHARE_CAP = 0.8; // 20 % de la marge restent pour couvrir les frais de paiement
const MIN_CHARGE = 1; // Stripe refuse les montants trop faibles

const roundDown = (v) => Math.floor((Number(v) + Number.EPSILON) * 100) / 100;

const normalizeCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

const isValidCode = (code) => /^[A-Z0-9_-]{3,24}$/.test(code);

const fail = (code, message) => ({ ok: false, code, message });

const validatePromo = ({ promo, now = new Date(), subtotal, currency, userRedemptions = 0, isFirstOrder = false }) => {
  if (!promo || !promo.active) return fail('PROMO_INVALID', 'Ce code promo n’existe pas ou n’est plus actif.');
  if (promo.startsAt && new Date(promo.startsAt) > now) return fail('PROMO_NOT_STARTED', 'Ce code promo n’est pas encore valable.');
  if (promo.expiresAt && new Date(promo.expiresAt) <= now) return fail('PROMO_EXPIRED', 'Ce code promo a expiré.');
  if (promo.type === 'fixed' && promo.currency && String(promo.currency).toUpperCase() !== String(currency).toUpperCase()) {
    return fail('PROMO_CURRENCY', 'Ce code promo n’est pas valable dans cette devise.');
  }
  if (promo.minSubtotal > 0 && subtotal < promo.minSubtotal) {
    return fail('PROMO_MIN_SUBTOTAL', `Ce code demande une commande d’au moins ${promo.minSubtotal.toFixed(2)} ${currency}.`);
  }
  if (promo.maxUses > 0 && promo.usedCount >= promo.maxUses) return fail('PROMO_EXHAUSTED', 'Ce code promo a atteint son nombre maximal d’utilisations.');
  if (userRedemptions >= (promo.perUserLimit || 1)) return fail('PROMO_ALREADY_USED', 'Tu as déjà utilisé ce code promo.');
  if (promo.firstOrderOnly && !isFirstOrder) return fail('PROMO_FIRST_ORDER_ONLY', 'Ce code est réservé à la première commande.');
  return { ok: true };
};

// Montant de la remise : jamais au-delà du sous-total, de la marge plateforme (80 %) ni d'un total inférieur à 1.
const computeDiscount = ({ promo, subtotal, deliveryFee, split }) => {
  const raw = promo.type === 'percent' ? (subtotal * promo.value) / 100 : promo.value;
  const platformMargin = Number(split?.platformCommissionAmount || 0) + Number(split?.platformDeliveryEarning || 0);
  const marginCap = platformMargin * PLATFORM_MARGIN_SHARE_CAP;
  const chargeCap = Math.max(0, subtotal + deliveryFee - MIN_CHARGE);
  return Math.max(0, roundDown(Math.min(raw, subtotal, marginCap, chargeCap)));
};

// Libère l'utilisation d'un code quand la commande est annulée (une seule fois).
const releasePromoForOrder = async (order, PromoCode) => {
  if (!order?.promoCode || order.promoReleased) return false;
  await PromoCode.updateOne({ code: order.promoCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  order.promoReleased = true;
  return true;
};

module.exports = { PROMO_TYPES, normalizeCode, isValidCode, validatePromo, computeDiscount, releasePromoForOrder, roundDown };
