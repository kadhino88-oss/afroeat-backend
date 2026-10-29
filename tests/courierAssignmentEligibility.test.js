'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCourierAssignmentEligibility,
} = require('../utils/courierAssignmentEligibility');

const eligibleCourier = () => ({
  role: 'livreur',
  accountStatus: 'active',
  isIdentityVerified: true,
  isWorkAuthorized: true,
  isAvailable: true,
});

test('allows an active, verified, authorized and available courier', () => {
  assert.deepEqual(evaluateCourierAssignmentEligibility(eligibleCourier()), {
    ok: true,
    status: 200,
    code: 'COURIER_ELIGIBLE',
    message: '',
  });
});

test('rejects a missing or non-courier account', () => {
  assert.equal(evaluateCourierAssignmentEligibility(null).code, 'INVALID_COURIER');
  assert.equal(
    evaluateCourierAssignmentEligibility({ ...eligibleCourier(), role: 'client' }).status,
    400,
  );
});

test('rejects inactive courier accounts', () => {
  const result = evaluateCourierAssignmentEligibility({
    ...eligibleCourier(),
    accountStatus: 'pending_verification',
  });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'COURIER_ACCOUNT_NOT_ACTIVE');
});

test('rejects couriers whose identity has not been verified', () => {
  const result = evaluateCourierAssignmentEligibility({
    ...eligibleCourier(),
    isIdentityVerified: false,
  });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'COURIER_IDENTITY_NOT_VERIFIED');
});

test('rejects couriers without verified work authorization', () => {
  const result = evaluateCourierAssignmentEligibility({
    ...eligibleCourier(),
    isWorkAuthorized: false,
  });
  assert.equal(result.status, 403);
  assert.equal(result.code, 'COURIER_WORK_NOT_AUTHORIZED');
});

test('rejects unavailable couriers', () => {
  const result = evaluateCourierAssignmentEligibility({
    ...eligibleCourier(),
    isAvailable: false,
  });
  assert.equal(result.status, 409);
  assert.equal(result.code, 'COURIER_NOT_AVAILABLE');
});

test('fails closed for missing verification and availability values', () => {
  const result = evaluateCourierAssignmentEligibility({
    role: 'livreur',
    accountStatus: 'active',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COURIER_IDENTITY_NOT_VERIFIED');
});
