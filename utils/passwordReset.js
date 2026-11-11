'use strict';

const crypto = require('crypto');

const RESET_TTL_MS = 60 * 60 * 1000; // 1 heure

const hashResetToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const generateResetToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) };
};

const isValidResetToken = (token) => /^[a-f0-9]{64}$/.test(String(token || ''));

const resetLink = (token) => {
  const base = String(process.env.PUBLIC_WEB_URL || 'https://afroeat.app').replace(/\/+$/, '');
  return `${base}/auth/reset-password?token=${token}`;
};

const resetEmail = (name, link) => ({
  subject: 'AfroEat – Réinitialisation de ton mot de passe',
  text: [
    `Bonjour${name ? ` ${name}` : ''},`,
    '',
    'Tu as demandé à réinitialiser ton mot de passe AfroEat. Clique sur ce lien (valable 1 heure) :',
    link,
    '',
    "Si tu n'es pas à l'origine de cette demande, ignore ce message : ton mot de passe ne change pas.",
  ].join('\n'),
});

module.exports = { RESET_TTL_MS, hashResetToken, generateResetToken, isValidResetToken, resetLink, resetEmail };
