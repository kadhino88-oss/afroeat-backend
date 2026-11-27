'use strict';

// Rayon de livraison d'un commerce : la distance entre le commerce et l'adresse du client est calculée
// côté serveur (le client n'envoie qu'un texte). Le géocodage est best-effort : en cas d'échec du service
// de cartes, la commande n'est PAS bloquée (mieux vaut une vente qu'un faux refus), mais le résultat le dit.
const { distanceKm } = require('./courierDispatch');
const { geocodeAddress } = require('./partnerRestaurant');

const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 100;

const defaultRadiusKm = () => {
  const value = Number(process.env.DEFAULT_DELIVERY_RADIUS_KM);
  return Number.isFinite(value) && value >= MIN_RADIUS_KM && value <= MAX_RADIUS_KM ? value : 10;
};

const radiusKmFor = (restaurant) => {
  const own = Number(restaurant?.deliveryRadiusKm);
  return Number.isFinite(own) && own >= MIN_RADIUS_KM && own <= MAX_RADIUS_KM ? own : defaultRadiusKm();
};

const restaurantPoint = (restaurant) => {
  const lat = Number(restaurant?.latitude ?? restaurant?.location?.latitude);
  const lng = Number(restaurant?.longitude ?? restaurant?.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};

// Petit cache mémoire (par instance) pour ne pas géocoder deux fois la même adresse (devis puis commande).
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

const cachedGeocode = async (key, geocode) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.point;
  const point = await geocode();
  if (point) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), point });
  }
  return point;
};

/**
 * @returns {{ ok: boolean, checked: boolean, distanceKm?: number, radiusKm: number }}
 * ok=false uniquement si l'adresse est géocodée ET hors rayon.
 */
const checkDeliveryZone = async ({ restaurant, address, geocode = geocodeAddress }) => {
  const radiusKm = radiusKmFor(restaurant);
  const origin = restaurantPoint(restaurant);
  const text = String(address || '').trim();
  if (!origin || text.length < 5) return { ok: true, checked: false, radiusKm };

  const key = `${restaurant?.country || ''}|${text.toLowerCase()}`;
  let target = null;
  try {
    target = await cachedGeocode(key, () => geocode(text, '', restaurant?.country || ''));
  } catch {
    target = null;
  }
  if (!target) return { ok: true, checked: false, radiusKm };

  const km = distanceKm(origin, target);
  if (km === null) return { ok: true, checked: false, radiusKm };
  return { ok: km <= radiusKm, checked: true, distanceKm: km, radiusKm };
};

module.exports = { checkDeliveryZone, radiusKmFor, defaultRadiusKm, MIN_RADIUS_KM, MAX_RADIUS_KM, _clearCache: () => cache.clear() };
