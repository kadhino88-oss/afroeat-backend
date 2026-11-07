'use strict';

const { findPlaces, clampRadiusKm } = require('../utils/overpass');

const parseCoords = (query) => {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
};

const handler = (kind) => async (req, res) => {
  const coords = parseCoords(req.query);
  if (!coords) {
    return res.status(400).json({ success: false, message: 'Coordonnées lat/lng invalides ou manquantes.' });
  }
  const radiusKm = clampRadiusKm(req.query.radius ?? req.query.maxDistance);
  try {
    const items = await findPlaces({ kind, ...coords, radiusKm });
    res.set('Cache-Control', 'public, max-age=300');
    if (kind === 'groceries') {
      return res.json({ success: true, radiusKm, count: items.length, groceries: items });
    }
    const restaurants = items.filter((p) => p.category === 'restaurant');
    const fastFoods = items.filter((p) => p.category === 'fast-food');
    return res.json({
      success: true,
      radiusKm,
      count: items.length,
      restaurants,
      fastFoods,
    });
  } catch (error) {
    console.error('Places nearby error:', error.message);
    return res.status(502).json({ success: false, message: 'Service de lieux temporairement indisponible.' });
  }
};

module.exports = {
  getNearbyPlaces: handler('restaurants'),
  getNearbyGroceries: handler('groceries'),
};
