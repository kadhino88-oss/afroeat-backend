'use strict';

// Source unique des devises supportées pour Stripe : facteur de conversion vers les « minor units »
// (centimes ou unité entière pour les devises sans décimales comme XOF / XAF) et montant minimum.
// Ne jamais dupliquer cette table ni diviser / multiplier par 100 en dur ailleurs.

const CURRENCY_CONFIG = Object.freeze({
  EUR: Object.freeze({ multiplier: 100, minAmount: 0.5 }),
  USD: Object.freeze({ multiplier: 100, minAmount: 0.5 }),
  GBP: Object.freeze({ multiplier: 100, minAmount: 0.3 }),
  CHF: Object.freeze({ multiplier: 100, minAmount: 0.5 }),
  CAD: Object.freeze({ multiplier: 100, minAmount: 0.5 }),
  XOF: Object.freeze({ multiplier: 1, minAmount: 100 }),
  XAF: Object.freeze({ multiplier: 1, minAmount: 100 }),
});

const normalizeCurrency = (currency) => String(currency || '').trim().toUpperCase();

const getCurrencyConfig = (currency) => CURRENCY_CONFIG[normalizeCurrency(currency)] || null;

const isSupportedCurrency = (currency) => getCurrencyConfig(currency) !== null;

const getMinAmount = (currency) => getCurrencyConfig(currency)?.minAmount ?? null;

// Montant décimal -> entier en minor units ; null si devise non supportée ou montant non numérique.
const toMinorUnits = (amount, currency) => {
  const config = getCurrencyConfig(currency);
  const value = Number(amount);
  if (!config || amount === null || amount === '' || !Number.isFinite(value)) return null;
  return Math.round(value * config.multiplier);
};

// Entier en minor units -> montant décimal arrondi à la précision de la devise ; null si invalide.
// Les devises hors table suivent la convention Stripe par défaut (2 décimales).
const fromMinorUnits = (minor, currency) => {
  const value = Number(minor);
  if (minor === null || minor === '' || minor === undefined || !Number.isFinite(value)) return null;
  const multiplier = getCurrencyConfig(currency)?.multiplier ?? 100;
  return Math.round((value / multiplier) * 100) / 100;
};

module.exports = {
  CURRENCY_CONFIG,
  normalizeCurrency,
  isSupportedCurrency,
  getMinAmount,
  toMinorUnits,
  fromMinorUnits,
};
