const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCommissionBps, floorDeliveryFee, courierMinimumFor } = require('../utils/partnerOffer');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');

const DAY = 86400000;
const now = Date.parse('2026-12-01T12:00:00Z');
const old = { createdAt: new Date(now - 90 * DAY) };

test('commission : 15 % standard, 8 % en livraison par le restaurant, 2,5 % le premier mois', () => {
  assert.equal(resolveCommissionBps(1500, old, now), 1500);
  assert.equal(resolveCommissionBps(1500, { ...old, selfDelivery: true }, now), 800);
  assert.equal(resolveCommissionBps(1500, { createdAt: new Date(now - 10 * DAY) }, now), 250);
  assert.equal(resolveCommissionBps(1500, { createdAt: new Date(now - 31 * DAY) }, now), 1500);
  assert.equal(resolveCommissionBps(500, { ...old, selfDelivery: true }, now), 500, 'jamais au-dessus du taux configuré');
});

test('frais de livraison : jamais sous le minimum livreur quand AFROEAT livre', () => {
  assert.equal(floorDeliveryFee(0, 'EUR', false), 3.5);
  assert.equal(floorDeliveryFee(2, 'CHF', false), 4);
  assert.equal(floorDeliveryFee(6, 'CHF', false), 6);
  assert.equal(floorDeliveryFee(0, 'EUR', true), 0, 'le restaurant qui livre fixe ses frais librement');
});

test('livreur : minimum garanti sans que la plateforme paie de sa poche', () => {
  const rates = { commissionBps: 1500, courierPayoutBps: 8000 };
  const low = calculateMarketplaceSplit({ itemsSubtotal: 30, deliveryFee: 4, rates, courierMinimum: courierMinimumFor('CHF') });
  assert.equal(low.driverEarning, 4); // 80 % = 3.20 → relevé à 4
  assert.equal(low.platformDeliveryEarning, 0); // jamais négatif
  const high = calculateMarketplaceSplit({ itemsSubtotal: 30, deliveryFee: 7, rates, courierMinimum: 4 });
  assert.equal(high.driverEarning, 5.6); // 80 % au-dessus du minimum
  const capped = calculateMarketplaceSplit({ itemsSubtotal: 30, deliveryFee: 2, rates, courierMinimum: 4 });
  assert.equal(capped.driverEarning, 2, 'plafonné aux frais encaissés');
});
