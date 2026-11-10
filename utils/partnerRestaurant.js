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

/** Géocodage best-effort (Nominatim, 4 s max) : un échec ne bloque jamais la création du compte. */
const geocodeAddress = async (address, city, country, fetchImpl = globalThis.fetch) => {
  try {
    const q = [address, city, country].filter(Boolean).join(', ');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetchImpl(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'AfroEat-partner-onboarding/1.0 (https://github.com/kadhino88-oss/afroeat-backend)' },
      }
    );
    clearTimeout(timer);
    if (!response.ok) return null;
    const [hit] = await response.json();
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
};

module.exports = { buildRestaurantFromApplication, geocodeAddress, currencyFor };
