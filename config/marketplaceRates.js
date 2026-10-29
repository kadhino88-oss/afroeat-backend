'use strict';

const MAX_BASIS_POINTS = 10000;

const loadMarketplaceRates = (
  raw = process.env.MARKETPLACE_RATES_JSON || ''
) => {
  const source = String(raw).trim();
  if (!source) return {};

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('MARKETPLACE_RATES_JSON doit contenir un objet JSON valide.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MARKETPLACE_RATES_JSON doit être un objet indexé par devise.');
  }

  const normalized = {};
  for (const [rawCurrency, rawRates] of Object.entries(parsed)) {
    const currency = String(rawCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Devise invalide dans MARKETPLACE_RATES_JSON: ${rawCurrency}`);
    }
    if (!rawRates || typeof rawRates !== 'object' || Array.isArray(rawRates)) {
      throw new Error(`Configuration de taux invalide pour ${currency}.`);
    }

    const { commissionBps, courierPayoutBps } = rawRates;
    for (const [label, value] of [
      ['commissionBps', commissionBps],
      ['courierPayoutBps', courierPayoutBps],
    ]) {
      if (!Number.isInteger(value) || value < 0 || value > MAX_BASIS_POINTS) {
        throw new Error(
          `${label} pour ${currency} doit être un entier entre 0 et ${MAX_BASIS_POINTS}.`
        );
      }
    }

    normalized[currency] = { commissionBps, courierPayoutBps };
  }

  return normalized;
};

const getMarketplaceRates = (currency) => {
  const currencyCode = String(currency || '').trim().toUpperCase();
  return loadMarketplaceRates()[currencyCode] || null;
};

module.exports = {
  loadMarketplaceRates,
  getMarketplaceRates,
  MAX_BASIS_POINTS,
};
