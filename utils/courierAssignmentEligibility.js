'use strict';

const normalize = (value) => String(value ?? '').trim().toLowerCase();

/**
 * A courier may receive a delivery only if the account is active, identity and
 * work authorisation have been verified, and the courier has marked themselves
 * available. Keep this policy pure so it can be tested without MongoDB.
 */
const evaluateCourierAssignmentEligibility = (courier) => {
  if (!courier || normalize(courier.role) !== 'livreur') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_COURIER',
      message: 'Le livreur sélectionné est invalide.',
    };
  }

  if (normalize(courier.accountStatus) !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'COURIER_ACCOUNT_NOT_ACTIVE',
      message: 'Ce livreur ne peut pas recevoir de commandes tant que son compte n’est pas actif.',
    };
  }

  if (courier.isIdentityVerified !== true) {
    return {
      ok: false,
      status: 403,
      code: 'COURIER_IDENTITY_NOT_VERIFIED',
      message: 'L’identité du livreur doit être vérifiée avant toute assignation.',
    };
  }

  if (courier.isWorkAuthorized !== true) {
    return {
      ok: false,
      status: 403,
      code: 'COURIER_WORK_NOT_AUTHORIZED',
      message: 'L’autorisation de travail du livreur doit être vérifiée avant toute assignation.',
    };
  }

  if (courier.isAvailable !== true) {
    return {
      ok: false,
      status: 409,
      code: 'COURIER_NOT_AVAILABLE',
      message: 'Ce livreur n’est pas disponible pour recevoir une commande.',
    };
  }

  return { ok: true, status: 200, code: 'COURIER_ELIGIBLE', message: '' };
};

/**
 * Validate the explicit decision an administrator makes after reviewing
 * courier documents. The note becomes part of the audit trail.
 */
const validateCourierVerificationUpdate = (payload = {}) => {
  const { isIdentityVerified, isWorkAuthorized } = payload;
  const note = String(payload.note ?? '').trim();

  if (
    typeof isIdentityVerified !== 'boolean' ||
    typeof isWorkAuthorized !== 'boolean'
  ) {
    return {
      ok: false,
      status: 400,
      code: 'COURIER_VERIFICATION_FLAGS_REQUIRED',
      message: 'Les deux décisions de vérification doivent être explicites.',
    };
  }

  if (isWorkAuthorized && !isIdentityVerified) {
    return {
      ok: false,
      status: 400,
      code: 'WORK_AUTH_REQUIRES_IDENTITY_VERIFICATION',
      message: 'L’identité doit être vérifiée avant de valider l’autorisation de travail.',
    };
  }

  if ((isIdentityVerified || isWorkAuthorized) && note.length < 8) {
    return {
      ok: false,
      status: 400,
      code: 'COURIER_VERIFICATION_NOTE_REQUIRED',
      message: 'Ajoute une note d’audit décrivant le contrôle documentaire effectué.',
    };
  }

  if (note.length > 500) {
    return {
      ok: false,
      status: 400,
      code: 'COURIER_VERIFICATION_NOTE_TOO_LONG',
      message: 'La note de vérification ne doit pas dépasser 500 caractères.',
    };
  }

  return {
    ok: true,
    status: 200,
    code: 'COURIER_VERIFICATION_VALID',
    isIdentityVerified,
    isWorkAuthorized,
    note,
  };
};

const evaluateCourierAvailabilityChange = (courier, available) => {
  if (!courier || normalize(courier.role) !== 'livreur') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_COURIER',
      message: 'Compte livreur invalide.',
    };
  }

  if (available === true && (
    courier.isIdentityVerified !== true ||
    courier.isWorkAuthorized !== true
  )) {
    return {
      ok: false,
      status: 403,
      code: 'COURIER_VERIFICATION_REQUIRED',
      message: 'L’identité et l’autorisation de travail doivent être vérifiées avant d’activer la disponibilité.',
    };
  }

  return { ok: true, status: 200, code: 'COURIER_AVAILABILITY_VALID', message: '' };
};

module.exports = {
  evaluateCourierAssignmentEligibility,
  validateCourierVerificationUpdate,
  evaluateCourierAvailabilityChange,
};
