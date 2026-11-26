'use strict';

const crypto = require('crypto');

// Authentifie un appel de tâche planifiée (cron) par secret partagé : `Authorization: Bearer <CRON_SECRET>`.
// Comparaison à temps constant (empreintes SHA-256 de longueur fixe) ; refusé si CRON_SECRET est absent.

const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();

/** @returns {{ ok: boolean, status?: number, code?: string }} */
const checkCronSecret = (req, env = process.env) => {
  const secret = String(env.CRON_SECRET || '').trim();
  if (!secret) return { ok: false, status: 403, code: 'CRON_DISABLED' };

  const header = String(req?.headers?.authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const provided = match ? match[1] : '';
  const valid = crypto.timingSafeEqual(digest(provided), digest(secret)) && provided.length > 0;
  return valid ? { ok: true } : { ok: false, status: 401, code: 'CRON_UNAUTHORIZED' };
};

module.exports = { checkCronSecret };
