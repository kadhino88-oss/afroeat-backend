'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateCourierAssignmentEligibility,
  validateCourierVerificationUpdate,
  evaluateCourierAvailabilityChange,
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


test('requires explicit boolean values for both verification decisions', () => {
  const result = validateCourierVerificationUpdate({ isIdentityVerified: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COURIER_VERIFICATION_FLAGS_REQUIRED');
});

test('does not authorize work before identity verification', () => {
  const result = validateCourierVerificationUpdate({
    isIdentityVerified: false,
    isWorkAuthorized: true,
    note: 'Autorisation vérifiée',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_AUTH_REQUIRES_IDENTITY_VERIFICATION');
});

test('requires an audit note before marking a courier verified', () => {
  const result = validateCourierVerificationUpdate({
    isIdentityVerified: true,
    isWorkAuthorized: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COURIER_VERIFICATION_NOTE_REQUIRED');
});

test('accepts an explicit documented review decision', () => {
  const result = validateCourierVerificationUpdate({
    isIdentityVerified: true,
    isWorkAuthorized: true,
    note: 'Pièce contrôlée, autorisation valide',
  });
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    code: 'COURIER_VERIFICATION_VALID',
    isIdentityVerified: true,
    isWorkAuthorized: true,
    note: 'Pièce contrôlée, autorisation valide',
  });
});

test('rejects overlong audit notes', () => {
  const result = validateCourierVerificationUpdate({
    isIdentityVerified: true,
    isWorkAuthorized: true,
    note: 'x'.repeat(501),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COURIER_VERIFICATION_NOTE_TOO_LONG');
});


test('prevents unverified couriers from activating availability', () => {
  const result = evaluateCourierAvailabilityChange({
    role: 'livreur',
    isIdentityVerified: false,
    isWorkAuthorized: false,
  }, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'COURIER_VERIFICATION_REQUIRED');
});

test('allows verified and authorized couriers to activate availability', () => {
  const result = evaluateCourierAvailabilityChange({
    role: 'livreur',
    isIdentityVerified: true,
    isWorkAuthorized: true,
  }, true);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'COURIER_AVAILABILITY_VALID');
});

test('allows a courier to deactivate availability even when verification is revoked', () => {
  const result = evaluateCourierAvailabilityChange({
    role: 'livreur',
    isIdentityVerified: false,
    isWorkAuthorized: false,
  }, false);
  assert.equal(result.ok, true);
});

test('rejects availability changes for non-courier accounts', () => {
  const result = evaluateCourierAvailabilityChange({ role: 'client' }, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_COURIER');
});
