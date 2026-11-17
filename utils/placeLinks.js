'use strict';

/**
 * Nettoyage des liens et images de l'annuaire avant affichage :
 * - jamais de lien vers une plateforme de livraison concurrente (Uber Eats, Deliveroo, Just Eat, Smood…) ;
 * - pas d'image inutilisable (vidéo, page web, image par défaut d'un outil de création de site, avatar minuscule).
 */
const COMPETITOR_HOSTS = [
  'ubereats.com',
  'uber.com',
  'deliveroo.fr',
  'deliveroo.ch',
  'deliveroo.com',
  'just-eat.ch',
  'just-eat.fr',
  'justeat.com',
  'eat.ch',
  'smood.ch',
  'lieferando.de',
  'lieferando.ch',
  'foodora.ch',
  'wolt.com',
];

const hostOf = (value) => {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isCompetitorUrl = (value) => {
  const host = hostOf(value);
  return Boolean(host) && COMPETITOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};

const cleanWebsite = (value) => {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url) || isCompetitorUrl(url)) return '';
  return url;
};

const PLACEHOLDER_IMAGE = [
  /lovable\.dev\/opengraph-image/i,
  /strikinglycdn\.com\/images\/fb_images\/default/i,
  /googleusercontent\.com\/a-\//i, // avatar de profil Google, pas une photo du commerce
];

const cleanImageUrl = (value) => {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url) || isCompetitorUrl(url)) return '';
  if (PLACEHOLDER_IMAGE.some((re) => re.test(url))) return '';
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return '';
  }
  if (/\.(mp4|webm|mov|m3u8)$/i.test(path)) return '';
  if (path === '/' || path === '') return ''; // adresse d'une page, pas d'une image
  return url;
};

module.exports = { isCompetitorUrl, cleanWebsite, cleanImageUrl, COMPETITOR_HOSTS };
