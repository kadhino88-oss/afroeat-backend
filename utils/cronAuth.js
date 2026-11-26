'use strict';

const crypto = require('crypto');

// Authentifie un appel de tâche planifiée (cron) par secret partagé : `Authorization: Bearer <CRON_SECRET>`.
// Comparaison à temps constant (empreintes SHA-256 de longueur fixe) ; refusé si CRON_SECRET est absent.

const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();

/** @returns {{ ok: boolean, status?: number, code?: string }} */
const checkCronSecret = (req, env = process.env) => {
  const secret = String(env.CRON_SECRET || '').trim();
  if (!secret) return { ok: false, status: 403, code: 'CRON_DISABLED' };

  // Analyse linéaire de « Bearer <jeton> » (pas de regex sur l'en-tête fourni par le client).
  const header = String(req?.headers?.authorization || '').trim();
  const space = header.indexOf(' ');
  let provided = '';
  if (space > 0 && header.slice(0, space).toLowerCase() === 'bearer') {
    const candidate = header.slice(space + 1).trim();
    provided = candidate.includes(' ') || candidate.includes('\t') ? '' : candidate;
  }
  const valid = crypto.timingSafeEqual(digest(provided), digest(secret)) && provided.length > 0;
  return valid ? { ok: true } : { ok: false, status: 401, code: 'CRON_UNAUTHORIZED' };
};

module.exports = { checkCronSecret };
