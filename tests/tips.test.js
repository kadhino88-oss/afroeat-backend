const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTip, applyTipToSplit } = require('../utils/tips');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');

test('pourboire : valeurs acceptées et refusées', () => {
  assert.deepEqual(parseTip(undefined), { ok: true, amount: 0 });
  assert.deepEqual(parseTip(''), { ok: true, amount: 0 });
  assert.equal(parseTip(2.345).amount, 2.35);
  assert.equal(parseTip(-1).ok, false);
  assert.equal(parseTip(51).ok, false);
  assert.equal(parseTip('abc').ok, false);
});

test('le pourboire va à 100 % au livreur, sans commission', () => {
  const rates = { commissionBps: 1500, courierPayoutBps: 8000 };
  const base = calculateMarketplaceSplit({ itemsSubtotal: 40, deliveryFee: 5, rates });
  const withTip = applyTipToSplit(base, 3, false);
  assert.equal(withTip.driverEarning, base.driverEarning + 3);
  assert.equal(withTip.platformCommissionAmount, base.platformCommissionAmount);
  assert.equal(withTip.restaurantEarning, base.restaurantEarning);
});

test('restaurant qui livre lui-même : le pourboire lui revient', () => {
  const rates = { commissionBps: 1500, courierPayoutBps: 8000 };
  const base = calculateMarketplaceSplit({ itemsSubtotal: 40, deliveryFee: 5, rates, selfDelivery: true });
  const withTip = applyTipToSplit(base, 2, true);
  assert.equal(withTip.restaurantEarning, base.restaurantEarning + 2);
  assert.equal(withTip.driverEarning, 0);
});
