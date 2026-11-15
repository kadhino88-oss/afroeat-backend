'use strict';

/**
 * Pièces demandées pour vérifier un partenaire, et durées de conservation.
 * - Tant qu'aucune décision n'est prise, le fichier est supprimé au bout de 90 jours.
 * - Après la décision (acceptée ou refusée), le fichier est supprimé au bout de 30 jours :
 *   seule la décision (date, résultat) est conservée, pas la pièce elle-même.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_RETENTION_DAYS = 90;
const DECIDED_RETENTION_DAYS = 30;

const REQUIRED_KINDS = {
  livreur: ['identity', 'work_permit'],
  restaurant: ['identity', 'business_registration'],
};

const ALL_KINDS = ['identity', 'work_permit', 'business_registration'];

const getRequiredKinds = (role) => REQUIRED_KINDS[String(role || '').toLowerCase()] || [];

const expiryAfterDays = (days, from = Date.now()) => new Date(from + days * DAY_MS);

/** Toutes les pièces demandées ont-elles été acceptées ? */
const isFullyApproved = (role, documents = []) => {
  const required = getRequiredKinds(role);
  if (!required.length) return false;
  return required.every((kind) =>
    documents.some((doc) => doc.kind === kind && doc.status === 'approved')
  );
};

module.exports = {
  PENDING_RETENTION_DAYS,
  DECIDED_RETENTION_DAYS,
  REQUIRED_KINDS,
  ALL_KINDS,
  getRequiredKinds,
  expiryAfterDays,
  isFullyApproved,
};
