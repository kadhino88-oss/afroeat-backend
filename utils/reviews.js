'use strict';

const REVIEW_WINDOW_DAYS = 14;

const toRating = (value, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false };
  return { ok: true, value: n };
};

/** Prénom + initiale du nom : jamais le nom complet d'un client en public. */
const publicAuthorName = (fullName) => {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Client';
  const first = parts[0].slice(0, 30);
  return parts[1] ? `${first} ${parts[1][0].toUpperCase()}.` : first;
};

/** Vérifie qu'un avis peut être laissé sur cette commande par cet utilisateur. */
const evaluateReviewEligibility = (order, userId, now = Date.now()) => {
  if (!order) return { ok: false, status: 404, code: 'ORDER_NOT_FOUND', message: 'Commande introuvable.' };
  if (String(order.user?._id || order.user) !== String(userId)) {
    return { ok: false, status: 403, code: 'NOT_YOUR_ORDER', message: 'Vous ne pouvez noter que vos propres commandes.' };
  }
  if (order.status !== 'Livrée') {
    return { ok: false, status: 409, code: 'ORDER_NOT_DELIVERED', message: 'Vous pourrez laisser un avis une fois la commande livrée.' };
  }
  const deliveredAt = new Date(order.deliveredAt || order.updatedAt || 0).getTime();
  if (deliveredAt && now - deliveredAt > REVIEW_WINDOW_DAYS * 86400000) {
    return { ok: false, status: 409, code: 'REVIEW_WINDOW_CLOSED', message: `Les avis sont possibles pendant ${REVIEW_WINDOW_DAYS} jours après la livraison.` };
  }
  return { ok: true };
};

/** Nouvelle moyenne après ajout d'une note (arrondie à 2 décimales). */
const addToAverage = (average, count, rating) => {
  const c = Math.max(0, Number(count) || 0);
  const a = Number(average) || 0;
  return { average: Math.round(((a * c + rating) / (c + 1)) * 100) / 100, count: c + 1 };
};

module.exports = { REVIEW_WINDOW_DAYS, toRating, publicAuthorName, evaluateReviewEligibility, addToAverage };
