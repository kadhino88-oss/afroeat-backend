'use strict';

/**
 * Pourboire laissé par le client : 100 % pour la personne qui livre
 * (livreur AFROEAT, ou le restaurant quand il livre lui-même). AFROEAT ne prélève rien dessus.
 */
const MAX_TIP = 50;

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const parseTip = (value) => {
  if (value === undefined || value === null || value === '') return { ok: true, amount: 0 };
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_TIP) {
    return {
      ok: false,
      code: 'INVALID_TIP_AMOUNT',
      message: `Le pourboire doit être compris entre 0 et ${MAX_TIP}.`,
    };
  }
  return { ok: true, amount: roundMoney(amount) };
};

/** Ajoute le pourboire à la répartition : tout au livreur, ou au restaurant s'il livre lui-même. */
const applyTipToSplit = (split, tip, selfDelivery) => {
  const amount = roundMoney(tip || 0);
  if (!amount) return { ...split };
  return selfDelivery
    ? { ...split, restaurantEarning: roundMoney(split.restaurantEarning + amount) }
    : { ...split, driverEarning: roundMoney(split.driverEarning + amount) };
};

module.exports = { MAX_TIP, parseTip, applyTipToSplit };
