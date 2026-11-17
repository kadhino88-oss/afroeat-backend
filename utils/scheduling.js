'use strict';

const { isWithinOpeningHours } = require('./openingHours');

/**
 * Commande programmée : livraison ou retrait plus tard (au moins 30 minutes après la commande,
 * au plus 7 jours), à une heure où le commerce est ouvert selon ses horaires.
 */
const MIN_LEAD_MIN = 30;
const MAX_DAYS = 7;
const DISPATCH_LEAD_MIN = 45; // la course est proposée aux livreurs 45 min avant l'heure prévue

const parseScheduledFor = (value, restaurant, now = Date.now()) => {
  if (value === undefined || value === null || value === '') return { ok: true, date: null };
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return { ok: false, code: 'INVALID_SCHEDULE', message: 'Heure programmée invalide.' };
  }
  if (time < now + MIN_LEAD_MIN * 60000) {
    return { ok: false, code: 'SCHEDULE_TOO_SOON', message: `Programmez au moins ${MIN_LEAD_MIN} minutes à l’avance.` };
  }
  if (time > now + MAX_DAYS * 86400000) {
    return { ok: false, code: 'SCHEDULE_TOO_FAR', message: `Programmez au plus ${MAX_DAYS} jours à l’avance.` };
  }
  if (!isWithinOpeningHours(restaurant?.openingHours, date)) {
    return { ok: false, code: 'SCHEDULE_OUTSIDE_HOURS', message: 'Le commerce est fermé à cette heure-là.' };
  }
  return { ok: true, date };
};

/** Une commande programmée n'est proposée aux livreurs qu'à l'approche de l'heure prévue. */
const isDueForDispatch = (order, now = Date.now()) => {
  if (!order?.scheduledFor) return true;
  return new Date(order.scheduledFor).getTime() - now <= DISPATCH_LEAD_MIN * 60000;
};

module.exports = { MIN_LEAD_MIN, MAX_DAYS, DISPATCH_LEAD_MIN, parseScheduledFor, isDueForDispatch };
