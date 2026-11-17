'use strict';

const Place = require('../models/Place');
const { SALON_SHOPS } = require('./osmPlaces');
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 3000;

const toApi = (doc) => {
  const [lng, lat] = doc.location.coordinates;
  const isGrocery = doc.kind === 'grocery';
  return {
    id: `osm-${String(doc.osmKey).replace('/', '-')}`,
    source: 'openstreetmap',
    // Catégories attendues par l'appli : restaurant, african-fast-food, african-grocery.
    category: doc.kind === 'shop'
      ? (SALON_SHOPS.has(doc.subtype) ? 'african-salon' : 'african-business')
      : isGrocery
      ? 'african-grocery'
      : doc.kind === 'fast_food' && doc.isAfrican ? 'african-fast-food' : 'restaurant',
    name: doc.name,
    cuisine: doc.cuisine || '',
    address: doc.address || '',
    city: doc.city || '',
    phone: doc.phone || '',
    website: doc.website || '',
    imageUrl: doc.imageUrl || '',
    logoUrl: doc.logoUrl || '',
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
  const kinds = kind === 'groceries' ? ['grocery', 'shop'] : ['restaurant', 'fast_food'];
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
  // Doublons : un lieu repris par un partenaire dont la fiche est visible n'est plus listé deux fois.
  const claimedIds = docs.map((d) => d.claimedRestaurant).filter(Boolean);
  let hidden = new Set();
  if (claimedIds.length) {
    const Restaurant = require('../models/Restaurant');
    const active = await Restaurant.find({ _id: { $in: claimedIds }, isActive: true }).select('_id').lean();
    hidden = new Set(active.map((r) => String(r._id)));
  }
  const visible = docs.filter((d) => !d.claimedRestaurant || !hidden.has(String(d.claimedRestaurant)));
  return { items: visible.map(toApi), total: Math.max(0, total - (docs.length - visible.length)) };
};

module.exports = { findStoredPlaces, toApi, clampLimit, DEFAULT_LIMIT, MAX_LIMIT };
