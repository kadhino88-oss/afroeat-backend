'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isRevenueRecognizedOrder } = require('../utils/revenueRecognition');

test('counts only explicit successful payment states', () => {
  for (const paymentStatus of ['Payé', 'PAYÉ', 'paid', 'PAID', 'paye']) {
    assert.equal(isRevenueRecognizedOrder({ paymentStatus }), true, paymentStatus);
  }
});

test('never treats unpaid, missing, or refunded payments as revenue', () => {
  for (const paymentStatus of [
    'Non payé', 'non paye', 'unpaid', 'Remboursé', 'rembourse', 'refunded', '', undefined, null,
  ]) {
    assert.equal(isRevenueRecognizedOrder({ paymentStatus }), false, String(paymentStatus));
  }
});

test('delivery status alone does not count as collected revenue', () => {
  assert.equal(
    isRevenueRecognizedOrder({ status: 'Livrée', paymentStatus: 'Non payé' }),
    false
  );
});
