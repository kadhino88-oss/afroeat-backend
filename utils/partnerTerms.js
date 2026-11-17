'use strict';

const toPercent = (bps) => Math.round(Number(bps) || 0) / 100;

// Commission par devise, en pourcentage ; « commissionPercent » commun si toutes les devises sont identiques.
const partnerTermsFromRates = (rates = {}) => {
  const byCurrency = {};
  for (const [currency, value] of Object.entries(rates || {})) {
    if (value && Number.isInteger(value.commissionBps)) byCurrency[currency] = toPercent(value.commissionBps);
  }
  const values = [...new Set(Object.values(byCurrency))];
  return {
    commissionByCurrency: byCurrency,
    commissionPercent: values.length === 1 ? values[0] : null,
    payout: 'per_delivered_order',
  };
};

module.exports = { partnerTermsFromRates };
