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

module.exports = { evaluateCourierAssignmentEligibility };
