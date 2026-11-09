'use strict';

/**
 * Autorisation d'origine CORS avec jokers limités.
 *
 * Une entrée de la liste peut contenir un ou plusieurs « * » qui remplacent
 * UNIQUEMENT des caractères de nom d'hôte [a-z0-9-] (jamais « . » ni « / »), ex. :
 *   https://afroeat-app-*-bk-entreprise.vercel.app
 * → utile pour les aperçus Vercel d'une équipe, sans ouvrir CORS à d'autres domaines.
 */
const escapeRegex = (value) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const toMatcher = (entry) => {
  if (!entry.includes('*')) return null;
  const source = entry.split('*').map(escapeRegex).join('[a-z0-9-]+');
  return new RegExp(`^${source}$`, 'i');
};

const isOriginAllowed = (origin, entries) => {
  if (!origin) return false;
  return entries.some((entry) => {
    if (!entry.includes('*')) return entry === origin;
    return toMatcher(entry).test(origin);
  });
};

module.exports = { isOriginAllowed };
