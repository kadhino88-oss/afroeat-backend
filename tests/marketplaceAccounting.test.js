'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');

test('allocates food commission and delivery payout using basis points', () => {
  const split = calculateMarketplaceSplit({
    itemsSubtotal: 100,
    deliveryFee: 8,
    rates: { commissionBps: 1250, courierPayoutBps: 6000 },
  });
  assert.deepEqual(split, {
    commissionRateBps: 1250,
    courierPayoutRateBps: 6000,
    platformCommissionAmount: 12.5,
    restaurantEarning: 87.5,
    driverEarning: 4.8,
    platformDeliveryEarning: 3.2,
  });
  assert.equal(split.platformCommissionAmount + split.restaurantEarning, 100);
  assert.equal(split.driverEarning + split.platformDeliveryEarning, 8);
});

test('preserves a configured zero courier payout instead of assigning the whole fee', () => {
  const split = calculateMarketplaceSplit({
    itemsSubtotal: 25,
    deliveryFee: 5,
    rates: { commissionBps: 1000, courierPayoutBps: 0 },
  });
  assert.equal(split.driverEarning, 0);
  assert.equal(split.platformDeliveryEarning, 5);
  assert.equal(split.restaurantEarning, 22.5);
});

test('uses zero rates only when no rate configuration was supplied', () => {
  const split = calculateMarketplaceSplit({ itemsSubtotal: 10, deliveryFee: 3 });
  assert.equal(split.platformCommissionAmount, 0);
  assert.equal(split.restaurantEarning, 10);
  assert.equal(split.driverEarning, 0);
  assert.equal(split.platformDeliveryEarning, 3);
});

test('rejects invalid amounts and invalid basis-point values', () => {
  assert.throws(() => calculateMarketplaceSplit({ itemsSubtotal: -1, deliveryFee: 3 }), /sous-total/);
  assert.throws(() => calculateMarketplaceSplit({ itemsSubtotal: 10, deliveryFee: NaN }), /livraison/);
  assert.throws(() => calculateMarketplaceSplit({
    itemsSubtotal: 10, deliveryFee: 3, rates: { commissionBps: 10001, courierPayoutBps: 0 },
  }), /commissionBps/);
  assert.throws(() => calculateMarketplaceSplit({
    itemsSubtotal: 10, deliveryFee: 3, rates: { commissionBps: 0, courierPayoutBps: 0.5 },
  }), /courierPayoutBps/);
});
