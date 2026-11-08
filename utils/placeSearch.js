'use strict';

const Place = require('../models/Place');
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 3000;

const toApi = (doc) => {
  const [lng, lat] = doc.location.coordinates;
  const isGrocery = doc.kind === 'grocery';
  return {
    id: `osm-${String(doc.osmKey).replace('/', '-')}`,
    source: 'openstreetmap',
    // Catégories attendues par l'appli : restaurant, african-fast-food, african-grocery.
    category: isGrocery
      ? 'african-grocery'
      : doc.kind === 'fast_food' && doc.isAfrican ? 'african-fast-food' : 'restaurant',
    name: doc.name,
    cuisine: doc.cuisine || '',
    address: doc.address || '',
    city: doc.city || '',
    phone: doc.phone || '',
    website: doc.website || '',
    openingHours: doc.openingHours || '',
    isAfrican: Boolean(doc.isAfrican),
    latitude: lat,
    longitude: lng,
    distanceKm: Math.round((doc.distanceMeters / 1000) * 10) / 10,
  };
};

// Recherche dans les lieux OpenStreetMap importés dans notre base (index géospatial).
const clampLimit = (value) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

// Renvoie { items, total } : total = nombre réel de lieux dans le rayon (même au-delà de la limite).
const findStoredPlaces = async ({ kind, lat, lng, radiusKm, limit, africanOnly = false }) => {
  const kinds = kind === 'groceries' ? ['grocery'] : ['restaurant', 'fast_food'];
  const max = clampLimit(limit);
  const extra = africanOnly ? { isAfrican: true } : {};
  const [docs, total] = await Promise.all([
    Place.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { kind: { $in: kinds }, ...extra },
      },
    },
    { $limit: max },
    ]),
    Place.countDocuments({
      kind: { $in: kinds },
      ...extra,
      location: { $geoWithin: { $centerSphere: [[lng, lat], radiusKm / 6378.1] } },
    }),
  ]);
  return { items: docs.map(toApi), total };
};

module.exports = { findStoredPlaces, toApi, clampLimit, DEFAULT_LIMIT, MAX_LIMIT };
