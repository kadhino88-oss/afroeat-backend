'use strict';

const AFRICAN_RE =
  /afri|s[ée]n[ée]gal|ivoir|camerou|congo|nigeria|ghana|malien|mali\b|guin[ée]|togo|b[ée]nin|ethiop|[ée]rythr|maroc|moroc|alg[ée]r|tunis|egypt|[ée]gypt|somali|kenya|tchad|gabon|burkina|madagas|maur/i;

const GROCERY_SHOPS = new Set(['supermarket', 'convenience', 'greengrocer', 'general', 'grocery', 'deli']);

const centroid = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === 'Point') return geometry.coordinates;
  const ring =
    geometry.type === 'Polygon' ? geometry.coordinates?.[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0]
    : geometry.type === 'LineString' ? geometry.coordinates
    : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
};

// Transforme une feature GeoJSON (osmium export) en document Place, ou null.
const featureToPlace = (feature, region = '') => {
  const tags = feature?.properties || {};
  const name = String(tags.name || '').trim();
  if (!name) return null;

  let kind = null;
  if (tags.amenity === 'restaurant') kind = 'restaurant';
  else if (tags.amenity === 'fast_food') kind = 'fast_food';
  else if (GROCERY_SHOPS.has(tags.shop)) kind = 'grocery';
  if (!kind) return null;

  const point = centroid(feature.geometry);
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;

  const idRaw = String(feature.id || tags['@id'] || '');
  if (!idRaw) return null;

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || '';
  const text = [tags.name, tags.cuisine, tags.brand, tags.operator, tags.description].join(' ');

  return {
    osmKey: idRaw,
    kind,
    name,
    cuisine: tags.cuisine || '',
    address: [street, tags['addr:postcode'], city].filter(Boolean).join(', '),
    city,
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    openingHours: tags.opening_hours || '',
    isAfrican: AFRICAN_RE.test(text),
    location: { type: 'Point', coordinates: [point[0], point[1]] },
    region,
  };
};

module.exports = { featureToPlace, centroid, AFRICAN_RE };
