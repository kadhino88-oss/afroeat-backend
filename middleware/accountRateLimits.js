'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');

// Limiteurs qui comptent TOUTES les requêtes (réussies ou non). authLimiter ignore les
// réponses 2xx (skipSuccessfulRequests), donc register / forgot-password n'y étaient jamais comptés.
// Compteurs en mémoire, par instance (comme les autres limiteurs du projet).

const hashKey = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);

const normalizedEmail = (req) => String(req.body?.email || '').trim().toLowerCase();

const base = { standardHeaders: true, legacyHeaders: false };

const createAccountRateLimiters = ({ isProduction = process.env.NODE_ENV === 'production', overrides = {} } = {}) => {
  const max = (prod, dev, key) => overrides[key] ?? (isProduction ? prod : dev);

  // Création de compte : par IP.
  const registerIp = rateLimit({
    ...base,
    windowMs: 60 * 60 * 1000,
    max: max(20, 500, 'registerIp'),
    message: { success: false, message: 'Trop de créations de compte. Réessaie plus tard.' },
  });

  // Mot de passe oublié : par IP, puis par e-mail (évite le mail-bombing d'une même boîte).
  const forgotIp = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max: max(10, 200, 'forgotIp'),
    message: { success: false, message: 'Trop de demandes. Réessaie dans quelques minutes.' },
  });
  const forgotEmail = rateLimit({
    ...base,
    windowMs: 60 * 60 * 1000,
    max: max(5, 100, 'forgotEmail'),
    // Sans e-mail exploitable, le contrôleur répondra 400 ; on ne compte que par IP dans ce cas.
    skip: (req) => !normalizedEmail(req),
    keyGenerator: (req) => `forgot:${hashKey(normalizedEmail(req))}`,
    message: { success: false, message: 'Trop de demandes pour cette adresse. Réessaie plus tard.' },
  });

  // Défi 2FA : plafond de tentatives par jeton de défi (valide 5 min), en plus du plafond par IP.
  const twoFactorChallenge = rateLimit({
    ...base,
    windowMs: 5 * 60 * 1000,
    max: max(5, 50, 'twoFactorChallenge'),
    skip: (req) => !req.body?.challengeToken,
    keyGenerator: (req) => `2fa:${hashKey(req.body?.challengeToken)}`,
    message: { success: false, code: 'CHALLENGE_LOCKED', message: 'Trop de codes erronés. Reconnecte-toi.' },
  });

  return {
    register: [registerIp],
    forgotPassword: [forgotIp, forgotEmail],
    twoFactorChallenge,
  };
};

module.exports = { createAccountRateLimiters };
