'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderPaymentCreationBlock } = require('../utils/orderPaymentGuard');

test('blocks a second payment for an already paid order', () => {
  assert.deepEqual(
    getOrderPaymentCreationBlock({ paymentStatus: 'Payé', status: 'Confirmée' }),
    { errorStatus: 409, errorMessage: 'Cette commande a déjà été payée.' }
  );
});

test('blocks a new charge for a fully refunded order', () => {
  assert.deepEqual(
    getOrderPaymentCreationBlock({ paymentStatus: 'Remboursé', status: 'Confirmée' }),
    {
      errorStatus: 409,
      errorMessage: 'Cette commande a été remboursée et ne peut plus être payée.',
    }
  );
});

test('blocks a payment for a canceled order', () => {
  assert.deepEqual(
    getOrderPaymentCreationBlock({ paymentStatus: 'Non payé', status: 'Annulée' }),
    { errorStatus: 409, errorMessage: 'Impossible de payer une commande annulée.' }
  );
});

test('allows an eligible unpaid order to proceed to payment-channel validation', () => {
  assert.equal(
    getOrderPaymentCreationBlock({ paymentStatus: 'Non payé', status: 'En attente' }),
    null
  );
});

test('reports a missing order without allowing payment creation', () => {
  assert.deepEqual(
    getOrderPaymentCreationBlock(null),
    { errorStatus: 404, errorMessage: 'Commande introuvable.' }
  );
});
