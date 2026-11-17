const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMarketplaceSplit } = require('../utils/marketplaceAccounting');
const { canTransitionStatus } = require('../controllers/orderController');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');

const rates = { commissionBps: 1500, courierPayoutBps: 8000 };

test('livraison par le restaurant : il garde tous les frais de livraison, pas de part livreur', () => {
  const split = calculateMarketplaceSplit({ itemsSubtotal: 40, deliveryFee: 5, rates, selfDelivery: true });
  assert.equal(split.platformCommissionAmount, 6);
  assert.equal(split.restaurantEarning, 39);
  assert.equal(split.driverEarning, 0);
  assert.equal(split.platformDeliveryEarning, 0);
});

test('livraison AFROEAT : répartition inchangée', () => {
  const split = calculateMarketplaceSplit({ itemsSubtotal: 40, deliveryFee: 5, rates });
  assert.equal(split.restaurantEarning, 34);
  assert.equal(split.driverEarning, 4);
  assert.equal(split.platformDeliveryEarning, 1);
});

test('le restaurant qui livre lui-même fait passer la commande en livraison puis livrée', () => {
  const self = { selfDelivery: true };
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'restaurant', self), true);
  assert.equal(canTransitionStatus('Confirmée', 'En livraison', 'restaurant', self), true);
  assert.equal(canTransitionStatus('En livraison', 'Livrée', 'restaurant', self), true);
  assert.equal(canTransitionStatus('En attente', 'Livrée', 'restaurant', self), false);
});

test('sans ce mode, le restaurant ne peut pas livrer ; le livreur ne peut pas toucher une commande livrée par le restaurant', () => {
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'restaurant'), false);
  assert.equal(canTransitionStatus('En livraison', 'Livrée', 'restaurant'), false);
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'livreur', { selfDelivery: true }), false);
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'livreur'), true);
});

test('modèles : mode de livraison sur le commerce et sur la commande', () => {
  assert.equal(new Restaurant({}).selfDelivery, false);
  assert.equal(new Order({}).selfDelivery, false);
});

test('à emporter : le restaurant remet la commande (Livrée), aucun livreur', () => {
  const { canTransitionStatus } = require('../controllers/orderController');
  assert.equal(canTransitionStatus('En préparation', 'Livrée', 'restaurant', { selfDelivery: true, pickup: true }), true);
  assert.equal(canTransitionStatus('Confirmée', 'Livrée', 'restaurant', { selfDelivery: true, pickup: true }), true);
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'restaurant', { selfDelivery: true, pickup: true }), false);
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'livreur', { selfDelivery: true, pickup: true }), false);
  assert.equal(canTransitionStatus('En préparation', 'Livrée', 'restaurant', {}), false, 'en livraison classique, le restaurant ne marque pas « livrée »');
});
