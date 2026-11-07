'use strict';

const Place = require('../models/Place');
const { MAX_RESULTS } = require('./overpass');

const toApi = (doc) => {
  const [lng, lat] = doc.location.coordinates;
  const isGrocery = doc.kind === 'grocery';
  return {
    id: `osm-${String(doc.osmKey).replace('/', '-')}`,
    source: 'openstreetmap',
    category: isGrocery
      ? (doc.isAfrican ? 'african-grocery' : 'grocery')
      : doc.kind === 'fast_food' ? 'fast-food' : 'restaurant',
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
const findStoredPlaces = async ({ kind, lat, lng, radiusKm }) => {
  const kinds = kind === 'groceries' ? ['grocery'] : ['restaurant', 'fast_food'];
  const docs = await Place.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { kind: { $in: kinds } },
      },
    },
    { $limit: MAX_RESULTS },
  ]);
  return docs.map(toApi);
};

module.exports = { findStoredPlaces, toApi };
