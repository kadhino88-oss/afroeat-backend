'use strict';

const { findPlaces, clampRadiusKm } = require('../utils/overpass');
const { findStoredPlaces } = require('../utils/placeSearch');

// 1) notre base (OpenStreetMap importé) ; 2) à défaut, Overpass en direct.
const loadItems = async (params) => {
  try {
    const stored = await findStoredPlaces(params);
    if (stored.items.length > 0) return stored;
  } catch (error) {
    console.error('Places stockés indisponibles :', error.message);
  }
  const found = await findPlaces(params);
  const items = params.africanOnly ? found.filter((p) => p.isAfrican) : found;
  return { items, total: items.length };
};

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
    // AFROEAT ne référence que des commerces africains (?all=1 désactive le filtre, pour les tests).
    const africanOnly = req.query.all !== '1';
    const { items, total } = await loadItems({ kind, ...coords, radiusKm, limit: req.query.limit, africanOnly });
    res.set('Cache-Control', 'public, max-age=300');
    if (kind === 'groceries') {
      return res.json({ success: true, radiusKm, count: items.length,
        total,
        hasMore: total > items.length, groceries: items });
    }
    const restaurants = items.filter((p) => p.category === 'restaurant');
    const fastFoods = items.filter((p) => p.category === 'african-fast-food');
    return res.json({
      success: true,
      radiusKm,
      count: items.length,
        total,
        hasMore: total > items.length,
      restaurants,
      fastFoods,
    });
  } catch (error) {
    console.error('Places nearby error:', error.message);
    // Service externe indisponible et base vide : on répond une liste vide (200) plutôt qu'une erreur,
    // pour que l'écran ne casse pas. `degraded` permet à l'appli d'afficher un message au besoin.
    res.set('Cache-Control', 'no-store');
    const empty = { success: true, degraded: true, radiusKm, count: 0, total: 0, hasMore: false };
    return res.json(kind === 'groceries' ? { ...empty, groceries: [] } : { ...empty, restaurants: [], fastFoods: [] });
  }
};

module.exports = {
  getNearbyPlaces: handler('restaurants'),
  getNearbyGroceries: handler('groceries'),
};
