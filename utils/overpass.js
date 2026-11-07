'use strict';

// Découverte de lieux réels via OpenStreetMap (Overpass API).
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'AfroEat/1.0 (https://github.com/kadhino88-oss/afroeat-backend)';
const MAX_RADIUS_KM = 100;
const MAX_RESULTS = 500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const AFRICAN_RE =
  /afri|s[ée]n[ée]gal|ivoir|camerou|congo|nigeria|ghana|malien|mali\b|guin[ée]|togo|b[ée]nin|ethiop|[ée]rythr|maroc|moroc|alg[ée]r|tunis|egypt|[ée]gypt|somali|kenya|tchad|gabon|burkina|madagas|maur/i;

const toRad = (d) => (d * Math.PI) / 180;
const distanceKm = (lat1, lon1, lat2, lon2) => {
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};

const clampRadiusKm = (value, fallback = 10) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_RADIUS_KM);
};

const buildQuery = (kind, lat, lng, radiusKm) => {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lng})`;
  const selectors =
    kind === 'groceries'
      ? ['shop~"^(supermarket|convenience|greengrocer|general|grocery|deli)$"']
      : ['amenity~"^(restaurant|fast_food)$"'];
  const body = selectors
    .flatMap((s) => [`node[${s}]${around};`, `way[${s}]${around};`])
    .join('');
  return `[out:json][timeout:25];(${body});out center tags ${MAX_RESULTS * 4};`;
};

const normalizeElement = (el, kind, lat, lng) => {
  const tags = el.tags || {};
  const pLat = el.lat ?? el.center?.lat;
  const pLng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || '';
  const text = [tags.name, tags.cuisine, tags.brand, tags.operator, tags.description].join(' ');
  const isAfrican = AFRICAN_RE.test(text);
  return {
    id: `osm-${el.type}-${el.id}`,
    source: 'openstreetmap',
    category:
      kind === 'groceries'
        ? isAfrican ? 'african-grocery' : 'grocery'
        : tags.amenity === 'fast_food' ? 'fast-food' : 'restaurant',
    amenity: tags.amenity || tags.shop || null,
    name: tags.name || '',
    cuisine: tags.cuisine || '',
    address: [street, tags['addr:postcode'], city].filter(Boolean).join(', '),
    city,
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    openingHours: tags.opening_hours || '',
    isAfrican,
    latitude: pLat,
    longitude: pLng,
    distanceKm: Math.round(distanceKm(lat, lng, pLat, pLng) * 10) / 10,
  };
};

const fetchOverpass = async (query) => {
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Overpass indisponible');
};

const findPlaces = async ({ kind, lat, lng, radiusKm }) => {
  const key = `${kind}:${lat.toFixed(2)}:${lng.toFixed(2)}:${Math.ceil(radiusKm)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;

  let data;
  try {
    data = await fetchOverpass(buildQuery(kind, lat, lng, radiusKm));
  } catch (error) {
    if (hit) return hit.items; // dernière réponse connue plutôt qu'une erreur
    throw error;
  }
  const seen = new Set();
  const items = (Array.isArray(data?.elements) ? data.elements : [])
    .map((el) => normalizeElement(el, kind, lat, lng))
    .filter((p) => p && p.name && p.distanceKm <= radiusKm && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_RESULTS);

  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), items });
  return items;
};

module.exports = { findPlaces, clampRadiusKm, distanceKm, MAX_RADIUS_KM, MAX_RESULTS };
