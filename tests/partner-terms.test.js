const test = require('node:test');
const assert = require('node:assert/strict');
const { partnerTermsFromRates } = require('../utils/partnerTerms');

test('commission commune exprimée en pourcentage', () => {
  const t = partnerTermsFromRates({ CHF: { commissionBps: 1500, courierPayoutBps: 8000 }, EUR: { commissionBps: 1500, courierPayoutBps: 8000 } });
  assert.equal(t.commissionPercent, 15);
  assert.deepEqual(t.commissionByCurrency, { CHF: 15, EUR: 15 });
});

test('commissions différentes : pas de taux commun, détail par devise', () => {
  const t = partnerTermsFromRates({ CHF: { commissionBps: 1500 }, EUR: { commissionBps: 1250 } });
  assert.equal(t.commissionPercent, null);
  assert.equal(t.commissionByCurrency.EUR, 12.5);
});

test('configuration absente : aucun taux annoncé', () => {
  assert.equal(partnerTermsFromRates({}).commissionPercent, null);
});
