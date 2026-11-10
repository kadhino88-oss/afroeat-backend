'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../models/User');
const { canTransitionStatus } = require('../controllers/orderController');
const { evaluateDeliveryPayment } = require('../utils/orderGuards');
const { evaluateCourierAssignmentEligibility } = require('../utils/courierAssignmentEligibility');
const { buildCourier, buildOwner } = require('../utils/testRestaurantSeed');

// Parcours d'une commande payée par carte :
// paiement confirmé -> Confirmée (voir paymentController) -> restaurant -> livreur.
test('parcours complet : restaurant prépare, livreur livre', () => {
  assert.ok(canTransitionStatus('En attente', 'Confirmée', 'restaurant'));
  assert.ok(canTransitionStatus('Confirmée', 'En préparation', 'restaurant'));
  assert.ok(canTransitionStatus('En préparation', 'En livraison', 'livreur'));
  assert.ok(canTransitionStatus('En livraison', 'Livrée', 'livreur'));
});

test('le livreur peut aussi récupérer une commande déjà confirmée (sans attendre la préparation)', () => {
  assert.ok(canTransitionStatus('Confirmée', 'En livraison', 'livreur'));
});

test('chaque rôle reste dans son périmètre', () => {
  // Le restaurant ne livre pas et ne saute pas d'étape.
  assert.equal(canTransitionStatus('En préparation', 'En livraison', 'restaurant'), false);
  assert.equal(canTransitionStatus('En livraison', 'Livrée', 'restaurant'), false);
  assert.equal(canTransitionStatus('En attente', 'En préparation', 'restaurant'), false);
  // Le livreur ne peut pas prendre une commande non confirmée ni la clôturer sans l'avoir prise.
  assert.equal(canTransitionStatus('En attente', 'En livraison', 'livreur'), false);
  assert.equal(canTransitionStatus('En préparation', 'Livrée', 'livreur'), false);
  assert.equal(canTransitionStatus('Confirmée', 'Annulée', 'livreur'), false);
  // Le client ne peut qu'annuler une commande encore en attente.
  assert.ok(canTransitionStatus('En attente', 'Annulée', 'client'));
  assert.equal(canTransitionStatus('Confirmée', 'Annulée', 'client'), false);
  assert.equal(canTransitionStatus('En préparation', 'Livrée', 'client'), false);
});

test('une commande livrée ou annulée ne bouge plus (sauf admin)', () => {
  for (const role of ['restaurant', 'livreur', 'client']) {
    assert.equal(canTransitionStatus('Livrée', 'En livraison', role), false);
    assert.equal(canTransitionStatus('Annulée', 'Confirmée', role), false);
  }
  assert.equal(canTransitionStatus('Livrée', 'En livraison', 'admin'), true);
});

test('livraison bloquée tant que la carte n’est pas payée', () => {
  const blocked = evaluateDeliveryPayment({ nextStatus: 'Livrée', paymentStatus: 'Non payé', paymentMethod: 'stripe_checkout' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'PAYMENT_REQUIRED_BEFORE_DELIVERY');
  const ok = evaluateDeliveryPayment({ nextStatus: 'Livrée', paymentStatus: 'Payé', paymentMethod: 'stripe_checkout' });
  assert.equal(ok.allowed, true);
});

test('le livreur de test est valide, éligible à une course et ne partage pas le compte du restaurant', () => {
  const courier = new User(buildCourier('Test-Passw0rd!x'));
  assert.equal(courier.validateSync(), undefined, String(courier.validateSync()));
  assert.equal(courier.role, 'livreur');
  assert.equal(evaluateCourierAssignmentEligibility(courier).ok, true);
  assert.notEqual(courier.email, buildOwner('x').email);
});

test('un livreur non vérifié ou indisponible ne reçoit pas de course', () => {
  for (const patch of [{ isIdentityVerified: false }, { isWorkAuthorized: false }, { isAvailable: false }, { accountStatus: 'pending_verification' }]) {
    const courier = { ...buildCourier('x'), _id: new mongoose.Types.ObjectId(), ...patch };
    assert.equal(evaluateCourierAssignmentEligibility(courier).ok, false, JSON.stringify(patch));
  }
});
