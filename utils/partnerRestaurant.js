'use strict';

/**
 * Fiche restaurant créée à partir d'une candidature acceptée, au moment où le partenaire
 * crée son compte. Fermée par défaut : le restaurateur l'ouvre quand son menu est prêt.
 */
const TYPE_MAP = { restaurant: 'restaurant', grocery: 'grocery', shop: 'shop', drinks: 'drinks', other: 'shop' };

const currencyFor = (country = '') => (/france/i.test(String(country)) ? 'EUR' : 'CHF');

const buildRestaurantFromApplication = (application, ownerId, point = null) => {
  const doc = {
    owner: ownerId,
    name: application.businessName,
    businessType: TYPE_MAP[application.businessType] || 'restaurant',
    cuisine: 'Africaine',
    address: application.address,
    city: application.city,
    country: application.country || 'Suisse',
    phone: application.phone,
    email: application.email,
    description: '',
    currency: currencyFor(application.country),
    deliveryFee: 0,
    isActive: true,
    isOpen: false,
  };
  if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
    doc.latitude = point.lat;
    doc.longitude = point.lng;
    doc.location = { latitude: point.lat, longitude: point.lng, updatedAt: new Date() };
  }
  return doc;
};

const UA = 'AfroEat-partner-onboarding/1.0 (https://github.com/kadhino88-oss/afroeat-backend)';

const fetchJson = async (url, fetchImpl) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const validPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;

/**
 * Géocodage best-effort (4 s par service) : Nominatim, puis Photon (komoot) en secours,
 * car Nominatim refuse souvent les serveurs d'hébergement. Un échec ne bloque jamais rien.
 */
const geocodeAddress = async (address, city, country, fetchImpl = globalThis.fetch) => {
  const q = encodeURIComponent([address, city, country].filter(Boolean).join(', '));
  try {
    const hits = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`, fetchImpl);
    const hit = Array.isArray(hits) ? hits[0] : null;
    const point = hit ? validPoint(Number(hit.lat), Number(hit.lon)) : null;
    if (point) return point;
  } catch {
    // on essaie le service suivant
  }
  try {
    const data = await fetchJson(`https://photon.komoot.io/api/?limit=1&q=${q}`, fetchImpl);
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords)) return validPoint(Number(coords[1]), Number(coords[0]));
  } catch {
    // aucun service disponible
  }
  return null;
};

module.exports = { buildRestaurantFromApplication, geocodeAddress, currencyFor };
