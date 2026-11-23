'use strict';

/**
 * 2FA obligatoire pour les administrateurs, avec délai de grâce.
 *
 * ADMIN_2FA_ENFORCE_AFTER (date ISO, ex. 2026-12-15T00:00:00Z) :
 *  - absente ou invalide : rien n'est imposé (comportement historique) ;
 *  - avant la date : le login renvoie la date limite pour que l'app admin affiche un rappel ;
 *  - à partir de la date : un admin sans 2FA ne peut plus utiliser l'API, sauf pour activer
 *    sa 2FA (/api/admin/2fa/status|setup|enable). Il peut donc toujours se connecter et s'enrôler.
 */
const getEnforceDate = (env = process.env) => {
  const raw = String(env.ADMIN_2FA_ENFORCE_AFTER || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isAdminTwoFactorEnforced = (env = process.env, now = new Date()) => {
  const date = getEnforceDate(env);
  return Boolean(date) && now.getTime() >= date.getTime();
};

const ENROLMENT_PATHS = new Set(['/api/admin/2fa/status', '/api/admin/2fa/setup', '/api/admin/2fa/enable']);

const isTwoFactorEnrolmentPath = (originalUrl) => {
  const path = String(originalUrl || '').split('?')[0].replace(/\/+$/u, '');
  return ENROLMENT_PATHS.has(path);
};

module.exports = { getEnforceDate, isAdminTwoFactorEnforced, isTwoFactorEnrolmentPath };
