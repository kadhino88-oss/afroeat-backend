'use strict';

const MAX_EMAIL_LENGTH = 254;

/**
 * Validation d'e-mail en temps linéaire (remplace /^[^\s@]+@[^\s@]+\.[^\s@]+$/, quadratique sur
 * une entrée client longue). Règle identique: un seul « @ », ni espace ni second « @ », une partie
 * locale non vide, et un domaine contenant un « . » entouré de caractères (dernier segment d'au
 * moins `minLastLabel` caractères).
 */
const isValidEmailAddress = (value, { minLastLabel = 1 } = {}) => {
  if (typeof value !== 'string' || value.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const last = domain.length - 1;
  for (let i = 1; i <= last - minLastLabel; i += 1) {
    if (domain.charCodeAt(i) === 46) return true;
  }
  return false;
};

module.exports = { isValidEmailAddress, MAX_EMAIL_LENGTH };
