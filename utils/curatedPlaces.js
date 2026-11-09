'use strict';

/**
 * Lieux africains saisis à la main (data/curated-african-places.json), géocodés via
 * OpenStreetMap Nominatim puis enregistrés comme les lieux importés d'OSM.
 */
const KINDS = ['restaurant', 'fast_food', 'grocery'];

const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const makeKey = (entry) => `curated/${slugify(entry.name)}-${slugify(entry.city)}`;

const validateEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return 'entrée invalide';
  if (!String(entry.name || '').trim()) return 'nom manquant';
  if (!KINDS.includes(entry.kind)) return `type invalide (${entry.kind})`;
  if (!String(entry.address || '').trim() || !String(entry.city || '').trim()) return 'adresse ou ville manquante';
  return null;
};

const buildQuery = (entry) =>
  [entry.address, [entry.postcode, entry.city].filter(Boolean).join(' '), entry.country]
    .filter(Boolean)
    .join(', ');

const toPlaceDoc = (entry, { lat, lng }) => ({
  osmKey: makeKey(entry),
  kind: entry.kind,
  name: String(entry.name).trim(),
  cuisine: String(entry.cuisine || '').trim(),
  address: `${entry.address}, ${[entry.postcode, entry.city].filter(Boolean).join(' ')}`,
  city: String(entry.city).trim(),
  website: '',
  isAfrican: true,
  location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
  region: 'curated',
  importedAt: new Date(),
});

module.exports = { slugify, makeKey, validateEntry, buildQuery, toPlaceDoc, KINDS };
