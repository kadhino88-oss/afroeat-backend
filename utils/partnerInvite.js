'use strict';

const crypto = require('crypto');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashInviteToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

/** Jeton aléatoire (affiché une seule fois à l'admin) ; seule son empreinte est stockée. */
const generateInviteToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
};

const isStrongPassword = (value) => {
  const password = String(value || '');
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
};

/** Une invitation est utilisable si elle existe, n'est pas expirée et n'a pas déjà servi. */
const getInviteState = (application, now = new Date()) => {
  if (!application || !application.inviteTokenHash) return { ok: false, code: 'INVITE_INVALID' };
  if (application.inviteUsedAt) return { ok: false, code: 'INVITE_USED' };
  if (!application.inviteExpiresAt || application.inviteExpiresAt < now) {
    return { ok: false, code: 'INVITE_EXPIRED' };
  }
  if (application.status === 'rejected') return { ok: false, code: 'INVITE_INVALID' };
  return { ok: true };
};

const INVITE_MESSAGES = {
  INVITE_INVALID: "Ce lien d'invitation n'est pas valide.",
  INVITE_USED: 'Ce lien a déjà été utilisé : connecte-toi avec ton compte.',
  INVITE_EXPIRED: "Ce lien a expiré. Demande une nouvelle invitation à l'équipe AFROEAT.",
};

/** Le partenaire ne saisit que ce qui lui est propre ; l'e-mail et le commerce viennent de la candidature. */
const validateInviteRegistration = (body) => {
  const name = String(body?.name || '').trim();
  const phone = String(body?.phone || '').replace(/[^\d+]/g, '');
  const password = String(body?.password || '');

  if (name.length < 2) throw new Error('Le nom est obligatoire.');
  if (phone.length < 8) throw new Error('Le numéro de téléphone est invalide.');
  if (!isStrongPassword(password)) {
    throw new Error(
      'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.'
    );
  }
  return { name, phone, password };
};

module.exports = {
  INVITE_TTL_MS,
  INVITE_MESSAGES,
  hashInviteToken,
  generateInviteToken,
  getInviteState,
  validateInviteRegistration,
  isStrongPassword,
};
