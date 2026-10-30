const mongoose = require('mongoose');

const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeText = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const ALLOWED_BUSINESS_TYPES = new Set(['restaurant', 'grocery', 'drinks', 'shop']);

const normalizeBusinessType = (value, fallback = 'restaurant') => {
  const normalized = normalizeText(value, fallback).toLowerCase();
  if (!ALLOWED_BUSINESS_TYPES.has(normalized)) {
    throw new Error('Type de commerce AFROEAT invalide.');
  }
  return normalized;
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizePage = (value) =>
  Math.max(normalizePositiveInteger(value, DEFAULT_PAGE), DEFAULT_PAGE);

const normalizeLimit = (value) =>
  Math.min(Math.max(normalizePositiveInteger(value, DEFAULT_LIMIT), 1), MAX_LIMIT);

const normalizeSort = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (['recent', 'oldest', 'name'].includes(normalized)) return normalized;
  return 'recent';
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value).toLowerCase();
  if (['true', '1', 'yes', 'oui'].includes(normalized)) return true;
  if (['false', '0', 'no', 'non'].includes(normalized)) return false;
  return fallback;
};

const escapeRegex = (value) =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSort = (sort) => {
  switch (normalizeSort(sort)) {
    case 'oldest': return { createdAt: 1, _id: 1 };
    case 'name':   return { name: 1, _id: -1 };
    default:       return { createdAt: -1, _id: -1 };
  }
};

const buildPaginationMeta = ({ total, page, limit }) => {
  const safeTotal = normalizeNumber(total, 0);
  const safePage  = normalizePage(page);
  const safeLimit = normalizeLimit(limit);
  const pages     = Math.max(Math.ceil(safeTotal / Math.max(safeLimit, 1)), 1);
  return {
    total: safeTotal,
    count: 0,
    page: safePage,
    pages,
    limit: safeLimit,
    hasPrevPage: safePage > 1,
    hasNextPage: safePage < pages,
  };
};

const hasSchemaPath = (schema, path) => {
  try { return Boolean(schema?.path(path)); } catch { return false; }
};

const populateRestaurantQuery = (query) => {
  if (!query) return query;
  if (hasSchemaPath(Restaurant.schema, 'owner')) {
    query.populate('owner', 'name email role phone accountStatus isIdentityVerified isWorkAuthorized');
  }
  if (hasSchemaPath(Restaurant.schema, 'menu'))  query.populate('menu');
  if (hasSchemaPath(Restaurant.schema, 'menus')) query.populate('menus');
  return query;
};

const buildRestaurantFilters = (query = {}) => {
  const filters = {};
  const search  = normalizeText(query.search);
  const cuisine = normalizeText(query.cuisine);
  const city    = normalizeText(query.city);
  const country = normalizeText(query.country);
  const ownerId = normalizeText(query.ownerId);

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filters.$or = [
      { name: regex }, { cuisine: regex }, { address: regex },
      { city: regex }, { country: regex }, { description: regex },
    ];
  }
  if (cuisine) filters.cuisine = new RegExp(`^${escapeRegex(cuisine)}$`, 'i');
  if (city)    filters.city    = new RegExp(`^${escapeRegex(city)}$`, 'i');
  if (country) filters.country = new RegExp(`^${escapeRegex(country)}$`, 'i');
  if (ownerId) {
    if (!isValidObjectId(ownerId)) throw new Error('ownerId invalide.');
    filters.owner = ownerId;
  }
  if (query.isOpen   !== undefined) filters.isOpen   = normalizeBoolean(query.isOpen,   false);
  if (query.isActive !== undefined) filters.isActive  = normalizeBoolean(query.isActive, true);
  return filters;
};

const toArray = (value) => (Array.isArray(value) ? value : []);

/**
 * =========================================================
 * ✅ OPTIMISÉ — Batch loading menu + orders
 * Au lieu de faire 1 requête par restaurant (N×2 requêtes),
 * on charge TOUT en 2 requêtes globales puis on regroupe.
 * 10 restaurants = 2 requêtes au lieu de 20.
 * =========================================================
 */
const batchLoadMenuItems = async (restaurantIds) => {
  if (!restaurantIds || restaurantIds.length === 0) return {};
  try {
    const items = await MenuItem.find({ restaurant: { $in: restaurantIds } })
      .sort({ isPopular: -1, isRecommended: -1, createdAt: -1 })
      .lean();
    return items.reduce((acc, item) => {
      const rid = String(item.restaurant);
      if (!acc[rid]) acc[rid] = [];
      acc[rid].push(item);
      return acc;
    }, {});
  } catch (error) {
    console.error('BATCH LOAD MENU ITEMS ERROR =>', error);
    return {};
  }
};

const batchLoadOrderStats = async (restaurantIds) => {
  if (!restaurantIds || restaurantIds.length === 0) return {};
  const emptyStats = {
    totalOrders: 0, pendingOrders: 0, confirmedOrders: 0,
    preparingOrders: 0, deliveringOrders: 0, deliveredOrders: 0,
    cancelledOrders: 0, revenue: 0,
  };
  try {
    const orders = await Order.find({ restaurant: { $in: restaurantIds } })
      .select('restaurant status totalPrice total totalAmount paymentStatus')
      .lean();

    return orders.reduce((acc, order) => {
      const rid    = String(order.restaurant);
      const status = normalizeText(order?.status).toLowerCase();
      const total  = normalizeNumber(order?.totalPrice ?? order?.total ?? order?.totalAmount, 0);
      const paid   = normalizeText(order?.paymentStatus).toLowerCase();

      if (!acc[rid]) acc[rid] = { ...emptyStats };
      acc[rid].totalOrders += 1;
      if (status.includes('pending') || status.includes('attente')) acc[rid].pendingOrders += 1;
      if (status.includes('confirm'))                                acc[rid].confirmedOrders += 1;
      if (status.includes('prepar'))                                 acc[rid].preparingOrders += 1;
      if (status.includes('livraison') || status.includes('route') || status.includes('delivery')) acc[rid].deliveringOrders += 1;
      if (status.includes('livrée') || status.includes('livree') || status.includes('delivered'))  acc[rid].deliveredOrders += 1;
      if (status.includes('annul') || status.includes('cancel'))    acc[rid].cancelledOrders += 1;
      if (paid.includes('paid') || paid.includes('payé') || paid.includes('paye') || status.includes('delivered') || status.includes('livree')) {
        acc[rid].revenue += total;
      }
      return acc;
    }, {});
  } catch (error) {
    console.error('BATCH LOAD ORDER STATS ERROR =>', error);
    return {};
  }
};

const getMenuDocumentsForRestaurant = async (restaurantId) => {
  if (!restaurantId || !isValidObjectId(restaurantId)) return [];
  try {
    return await MenuItem.find({ restaurant: restaurantId })
      .sort({ isPopular: -1, isRecommended: -1, createdAt: -1 })
      .lean();
  } catch (error) {
    console.error('GET MENU DOCUMENTS FOR RESTAURANT ERROR =>', error);
    return [];
  }
};

const getOrderStatsForRestaurant = async (restaurantId) => {
  const emptyStats = {
    totalOrders: 0, pendingOrders: 0, confirmedOrders: 0,
    preparingOrders: 0, deliveringOrders: 0, deliveredOrders: 0,
    cancelledOrders: 0, revenue: 0,
  };
  if (!restaurantId || !isValidObjectId(restaurantId)) return emptyStats;
  try {
    const orders = await Order.find({ restaurant: restaurantId })
      .select('status totalPrice total totalAmount paymentStatus')
      .lean();
    return orders.reduce((acc, order) => {
      const status = normalizeText(order?.status).toLowerCase();
      const total  = normalizeNumber(order?.totalPrice ?? order?.total ?? order?.totalAmount, 0);
      const paid   = normalizeText(order?.paymentStatus).toLowerCase();
      acc.totalOrders += 1;
      if (status.includes('pending') || status.includes('attente')) acc.pendingOrders += 1;
      if (status.includes('confirm'))                                acc.confirmedOrders += 1;
      if (status.includes('prepar'))                                 acc.preparingOrders += 1;
      if (status.includes('livraison') || status.includes('route')) acc.deliveringOrders += 1;
      if (status.includes('livrée') || status.includes('livree') || status.includes('delivered')) acc.deliveredOrders += 1;
      if (status.includes('annul') || status.includes('cancel'))   acc.cancelledOrders += 1;
      if (paid.includes('paid') || paid.includes('payé') || paid.includes('paye') || status.includes('delivered') || status.includes('livree')) {
        acc.revenue += total;
      }
      return acc;
    }, { ...emptyStats });
  } catch (error) {
    console.error('GET ORDER STATS FOR RESTAURANT ERROR =>', error);
    return emptyStats;
  }
};

const computeMenuStats = (menuItems, stats) => {
  const safeMenus = toArray(menuItems);
  const categories = [...new Set(safeMenus.map((i) => normalizeText(i?.category)).filter(Boolean))];
  const prices     = safeMenus.map((i) => normalizeNumber(i?.price, NaN)).filter((v) => Number.isFinite(v) && v >= 0);
  const avg        = prices.length > 0 ? Number((prices.reduce((s, v) => s + v, 0) / prices.length).toFixed(2)) : 0;
  return {
    ...stats,
    averageMenuPrice:  avg,
    cheapestMenuPrice: prices.length > 0 ? Math.min(...prices) : 0,
    highestMenuPrice:  prices.length > 0 ? Math.max(...prices) : 0,
    menuItemsCount:    safeMenus.length,
    categoriesCount:   categories.length,
  };
};

const enrichRestaurantWithData = (restaurantDoc, menuItems, stats) => {
  if (!restaurantDoc) return null;
  const restaurant = typeof restaurantDoc.toObject === 'function'
    ? restaurantDoc.toObject({ virtuals: true })
    : { ...restaurantDoc };

  const safeMenus    = toArray(menuItems);
  const safeStats    = stats || { totalOrders: 0, pendingOrders: 0, confirmedOrders: 0, preparingOrders: 0, deliveringOrders: 0, deliveredOrders: 0, cancelledOrders: 0, revenue: 0 };
  const computedStats = computeMenuStats(safeMenus, safeStats);
  const categories   = [...new Set(safeMenus.map((i) => normalizeText(i?.category)).filter(Boolean))];

  return {
    ...restaurant,
    menu:       safeMenus,
    menus:      safeMenus,
    categories,
    stats:      computedStats,
    totalOrders:      safeStats.totalOrders,
    pendingOrders:    safeStats.pendingOrders,
    confirmedOrders:  safeStats.confirmedOrders,
    preparingOrders:  safeStats.preparingOrders,
    deliveringOrders: safeStats.deliveringOrders,
    deliveredOrders:  safeStats.deliveredOrders,
    cancelledOrders:  safeStats.cancelledOrders,
    revenue: Number(normalizeNumber(safeStats.revenue, 0).toFixed(2)),
  };
};

// Utilisé uniquement pour getRestaurantById (single doc)
const enrichRestaurant = async (restaurantDoc) => {
  if (!restaurantDoc) return null;
  const restaurant = typeof restaurantDoc.toObject === 'function'
    ? restaurantDoc.toObject({ virtuals: true })
    : { ...restaurantDoc };
  const restaurantId = String(restaurant?._id);

  let menus = [];
  if (Array.isArray(restaurant?.menu) && restaurant.menu.length > 0)   menus = restaurant.menu;
  else if (Array.isArray(restaurant?.menus) && restaurant.menus.length > 0) menus = restaurant.menus;
  else menus = await getMenuDocumentsForRestaurant(restaurantId);

  const stats = await getOrderStatsForRestaurant(restaurantId);
  return enrichRestaurantWithData(restaurant, menus, stats);
};

const getRestaurantOwnerId = (restaurant) => {
  const rawOwner = restaurant?.owner;
  if (!rawOwner) return '';
  if (typeof rawOwner === 'string') return rawOwner;
  if (rawOwner?._id) return String(rawOwner._id);
  return '';
};

const canManageRestaurant = (req, restaurant) => {
  if (!req?.user || !restaurant) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'restaurant') {
    return getRestaurantOwnerId(restaurant) === String(req.user._id);
  }
  return false;
};

const buildCreatePayload = async (reqBody = {}, reqUser = null) => {
  const payload    = {};
  const incomingOwner = normalizeText(reqBody.owner);
  const ownerId    = reqUser?.role === 'restaurant' ? String(reqUser._id) : incomingOwner;

  if (!ownerId || !isValidObjectId(ownerId)) throw new Error('Propriétaire invalide.');
  const owner = await User.findById(ownerId).select('_id role accountStatus');
  if (!owner) throw new Error('Propriétaire introuvable.');
  if (!['restaurant', 'admin'].includes(normalizeText(owner.role).toLowerCase())) {
    throw new Error('Le propriétaire doit être un compte restaurant.');
  }

  payload.owner       = owner._id;
  payload.name        = normalizeText(reqBody.name);
  payload.businessType = normalizeBusinessType(reqBody.businessType);
  payload.cuisine     = normalizeText(reqBody.cuisine);
  payload.address     = normalizeText(reqBody.address);
  payload.city        = normalizeText(reqBody.city);
  payload.country     = normalizeText(reqBody.country);
  payload.description = normalizeText(reqBody.description);
  payload.phone       = normalizeText(reqBody.phone);
  payload.email       = normalizeText(reqBody.email);
  payload.image       = normalizeText(reqBody.image);
  payload.coverImage  = normalizeText(reqBody.coverImage);
  payload.currency    = normalizeText(reqBody.currency, 'EUR').toUpperCase();
  payload.deliveryFee = normalizeNumber(reqBody.deliveryFee, 0);

  if (!payload.name)    throw new Error('Le nom du restaurant est obligatoire.');
  if (!payload.address) throw new Error("L'adresse du restaurant est obligatoire.");
  if (payload.deliveryFee < 0) throw new Error('Les frais de livraison sont invalides.');

  if (reqBody.isOpen    !== undefined) payload.isOpen    = normalizeBoolean(reqBody.isOpen,    false);
  if (reqBody.autoAcceptOrders !== undefined) payload.autoAcceptOrders = normalizeBoolean(reqBody.autoAcceptOrders, false);
  if (reqBody.notificationsEnabled !== undefined) payload.notificationsEnabled = normalizeBoolean(reqBody.notificationsEnabled, true);
  if (reqBody.preparationMode !== undefined) payload.preparationMode = normalizeBoolean(reqBody.preparationMode, true);
  if (reqBody.isActive  !== undefined) payload.isActive   = normalizeBoolean(reqBody.isActive,  true);
  if (reqBody.latitude  !== undefined) payload.latitude   = normalizeNumber(reqBody.latitude,   NaN);
  if (reqBody.longitude !== undefined) payload.longitude  = normalizeNumber(reqBody.longitude,  NaN);

  return payload;
};

const buildUpdatePayload = async (reqBody = {}) => {
  const payload = {};
  if (reqBody.name        !== undefined) payload.name        = normalizeText(reqBody.name);
  if (reqBody.businessType !== undefined) payload.businessType = normalizeBusinessType(reqBody.businessType);
  if (reqBody.cuisine     !== undefined) payload.cuisine     = normalizeText(reqBody.cuisine);
  if (reqBody.address     !== undefined) payload.address     = normalizeText(reqBody.address);
  if (reqBody.city        !== undefined) payload.city        = normalizeText(reqBody.city);
  if (reqBody.country     !== undefined) payload.country     = normalizeText(reqBody.country);
  if (reqBody.description !== undefined) payload.description = normalizeText(reqBody.description);
  if (reqBody.phone       !== undefined) payload.phone       = normalizeText(reqBody.phone);
  if (reqBody.email       !== undefined) payload.email       = normalizeText(reqBody.email);
  if (reqBody.image       !== undefined) payload.image       = normalizeText(reqBody.image);
  if (reqBody.coverImage  !== undefined) payload.coverImage  = normalizeText(reqBody.coverImage);
  if (reqBody.currency    !== undefined) payload.currency    = normalizeText(reqBody.currency, 'EUR').toUpperCase();
  if (reqBody.deliveryFee !== undefined) payload.deliveryFee = normalizeNumber(reqBody.deliveryFee, 0);
  if (reqBody.isOpen      !== undefined) payload.isOpen      = normalizeBoolean(reqBody.isOpen, false);
  if (reqBody.autoAcceptOrders !== undefined) payload.autoAcceptOrders = normalizeBoolean(reqBody.autoAcceptOrders, false);
  if (reqBody.notificationsEnabled !== undefined) payload.notificationsEnabled = normalizeBoolean(reqBody.notificationsEnabled, true);
  if (reqBody.preparationMode !== undefined) payload.preparationMode = normalizeBoolean(reqBody.preparationMode, true);
  if (reqBody.isActive    !== undefined) payload.isActive    = normalizeBoolean(reqBody.isActive, true);
  if (reqBody.latitude    !== undefined) payload.latitude    = normalizeNumber(reqBody.latitude,  NaN);
  if (reqBody.longitude   !== undefined) payload.longitude   = normalizeNumber(reqBody.longitude, NaN);

  if (reqBody.owner !== undefined) {
    const ownerId = normalizeText(reqBody.owner);
    if (!ownerId || !isValidObjectId(ownerId)) throw new Error('Propriétaire invalide.');
    const owner = await User.findById(ownerId).select('_id role');
    if (!owner) throw new Error('Propriétaire introuvable.');
    if (!['restaurant', 'admin'].includes(normalizeText(owner.role).toLowerCase())) {
      throw new Error('Le propriétaire doit être un compte restaurant.');
    }
    payload.owner = owner._id;
  }

  if (payload.name        !== undefined && !payload.name)        throw new Error('Le nom du restaurant est obligatoire.');
  if (payload.address     !== undefined && !payload.address)     throw new Error("L'adresse du restaurant est obligatoire.");
  if (payload.deliveryFee !== undefined && payload.deliveryFee < 0) throw new Error('Les frais de livraison sont invalides.');

  return payload;
};

/**
 * =========================================================
 * CONTROLLERS
 * =========================================================
 */

const getRestaurants = async (req, res) => {
  try {
    const page    = normalizePage(req.query.page);
    const limit   = normalizeLimit(req.query.limit);
    const sort    = normalizeSort(req.query.sort);
    const filters = buildRestaurantFilters(req.query);

    const [total, restaurants] = await Promise.all([
      Restaurant.countDocuments(filters),
      populateRestaurantQuery(
        Restaurant.find(filters).sort(buildSort(sort)).skip((page - 1) * limit).limit(limit)
      ),
    ]);

    // ✅ OPTIMISÉ — 2 requêtes batch au lieu de N×2 requêtes individuelles
    const restaurantIds = restaurants.map((r) => r._id);
    const [menuMap, statsMap] = await Promise.all([
      batchLoadMenuItems(restaurantIds),
      batchLoadOrderStats(restaurantIds),
    ]);

    const items = restaurants.map((restaurantDoc) => {
      const restaurant = typeof restaurantDoc.toObject === 'function'
        ? restaurantDoc.toObject({ virtuals: true })
        : { ...restaurantDoc };
      const rid = String(restaurant._id);

      // Si menu embarqué dans le doc, on l'utilise. Sinon on prend le batch.
      let menus = [];
      if (Array.isArray(restaurant?.menu)  && restaurant.menu.length  > 0) menus = restaurant.menu;
      else if (Array.isArray(restaurant?.menus) && restaurant.menus.length > 0) menus = restaurant.menus;
      else menus = menuMap[rid] || [];

      return enrichRestaurantWithData(restaurant, menus, statsMap[rid]);
    }).filter(Boolean);

    const pagination = buildPaginationMeta({ total, page, limit });

    return res.status(200).json({
      success: true,
      restaurants: items,
      count: items.length,
      total: pagination.total,
      page: pagination.page,
      pages: pagination.pages,
      limit: pagination.limit,
      hasPrevPage: pagination.hasPrevPage,
      hasNextPage: pagination.hasNextPage,
      pagination: { ...pagination, count: items.length },
      filters: {
        search:   normalizeText(req.query.search),
        cuisine:  normalizeText(req.query.cuisine),
        city:     normalizeText(req.query.city),
        country:  normalizeText(req.query.country),
        ownerId:  normalizeText(req.query.ownerId),
        sort,
        isOpen:   req.query.isOpen,
        isActive: req.query.isActive,
      },
    });
  } catch (error) {
    console.error('GET RESTAURANTS ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Impossible de charger les restaurants.',
    });
  }
};

// Distance a vol d'oiseau (km) entre deux points GPS - formule de Haversine.
// Pas besoin d'index geospatial MongoDB tant que le nombre de restaurants
// reste petit (debut de projet) ; a migrer vers un index 2dsphere + $near
// si le catalogue grossit beaucoup.
const distanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getRestaurantCoords = (restaurant) => {
  const lat = normalizeNumber(
    restaurant?.latitude ?? restaurant?.location?.latitude,
    NaN
  );
  const lng = normalizeNumber(
    restaurant?.longitude ?? restaurant?.location?.longitude,
    NaN
  );
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

// Detection automatique des restaurants africains a proximite d'un point
// GPS (utilise par l'app pour l'auto-detection de zone France/Suisse/etc.
// a l'ouverture, cote client - jamais d'appel a une clef de geocodage
// externe payante, uniquement les coordonnees restaurant deja en base).
const getNearbyRestaurants = async (req, res) => {
  try {
    const lat = normalizeNumber(req.query.lat, NaN);
    const lng = normalizeNumber(req.query.lng, NaN);
    const maxDistance = normalizeNumber(req.query.maxDistance, 10);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        success: false,
        message: 'Coordonnées lat/lng invalides ou manquantes.',
      });
    }

    if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
      return res.status(400).json({
        success: false,
        message: 'maxDistance invalide.',
      });
    }

    const filters = buildRestaurantFilters(req.query);
    if (filters.isActive === undefined) filters.isActive = true;

    const restaurants = await populateRestaurantQuery(Restaurant.find(filters));

    const withDistance = restaurants
      .map((restaurantDoc) => {
        const restaurant =
          typeof restaurantDoc.toObject === 'function'
            ? restaurantDoc.toObject({ virtuals: true })
            : { ...restaurantDoc };

        const coords = getRestaurantCoords(restaurant);
        if (!coords) return null;

        const distance = distanceKm(lat, lng, coords.lat, coords.lng);
        if (distance > maxDistance) return null;

        return { restaurant, distance };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);

    const restaurantIds = withDistance.map((entry) => entry.restaurant._id);
    const [menuMap, statsMap] = await Promise.all([
      batchLoadMenuItems(restaurantIds),
      batchLoadOrderStats(restaurantIds),
    ]);

    const items = withDistance
      .map(({ restaurant, distance }) => {
        const rid = String(restaurant._id);

        let menus = [];
        if (Array.isArray(restaurant?.menu) && restaurant.menu.length > 0) {
          menus = restaurant.menu;
        } else if (
          Array.isArray(restaurant?.menus) &&
          restaurant.menus.length > 0
        ) {
          menus = restaurant.menus;
        } else {
          menus = menuMap[rid] || [];
        }

        const enriched = enrichRestaurantWithData(
          restaurant,
          menus,
          statsMap[rid]
        );
        if (!enriched) return null;

        return { ...enriched, distanceKm: Number(distance.toFixed(2)) };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      restaurants: items,
      count: items.length,
      origin: { lat, lng },
      maxDistance,
    });
  } catch (error) {
    console.error('GET NEARBY RESTAURANTS ERROR =>', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Impossible de charger les restaurants à proximité.',
    });
  }
};

const getMyRestaurant = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Utilisateur non autorisé.' });
    }
    const restaurants = await populateRestaurantQuery(
      Restaurant.find({ owner: req.user._id }).sort({ createdAt: -1 })
    );
    const items     = await Promise.all(restaurants.map(enrichRestaurant));
    const restaurant = items[0] || null;
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Aucun restaurant lié à ce compte.' });
    }
    return res.status(200).json({ success: true, restaurant, restaurants: items, count: items.length });
  } catch (error) {
    console.error('GET MY RESTAURANT ERROR =>', error);
    return res.status(500).json({ success: false, message: error.message || 'Impossible de charger le restaurant.' });
  }
};

const getRestaurantById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID restaurant invalide.' });
    }
    const restaurant = await populateRestaurantQuery(Restaurant.findById(id));
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant introuvable.' });
    }
    const enrichedRestaurant = await enrichRestaurant(restaurant);
    return res.status(200).json({ success: true, restaurant: enrichedRestaurant });
  } catch (error) {
    console.error('GET RESTAURANT BY ID ERROR =>', error);
    return res.status(500).json({ success: false, message: error.message || 'Impossible de charger ce restaurant.' });
  }
};

const createRestaurant = async (req, res) => {
  try {
    const payload          = await buildCreatePayload(req.body, req.user);
    const restaurant       = await Restaurant.create(payload);
    const savedRestaurant  = await populateRestaurantQuery(Restaurant.findById(restaurant._id));
    const enrichedRestaurant = await enrichRestaurant(savedRestaurant);
    return res.status(201).json({ success: true, message: 'Restaurant créé avec succès.', restaurant: enrichedRestaurant });
  } catch (error) {
    console.error('CREATE RESTAURANT ERROR =>', error);
    return res.status(400).json({ success: false, message: error.message || 'Impossible de créer le restaurant.' });
  }
};

const updateRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID restaurant invalide.' });
    }
    const existingRestaurant = await Restaurant.findById(id);
    if (!existingRestaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant introuvable.' });
    }
    if (!canManageRestaurant(req, existingRestaurant)) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas accès à ce restaurant." });
    }
    const payload          = await buildUpdatePayload(req.body);
    const updatedRestaurant = await populateRestaurantQuery(
      Restaurant.findByIdAndUpdate(id, payload, { new: true, runValidators: true })
    );
    const enrichedRestaurant = await enrichRestaurant(updatedRestaurant);
    return res.status(200).json({ success: true, message: 'Restaurant mis à jour avec succès.', restaurant: enrichedRestaurant });
  } catch (error) {
    console.error('UPDATE RESTAURANT ERROR =>', error);
    return res.status(400).json({ success: false, message: error.message || 'Impossible de mettre à jour le restaurant.' });
  }
};

const deleteRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID restaurant invalide.' });
    }
    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant introuvable.' });
    }
    if (!canManageRestaurant(req, restaurant)) {
      return res.status(403).json({ success: false, message: "Vous n'avez pas accès à ce restaurant." });
    }
    await Restaurant.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: 'Restaurant supprimé avec succès.' });
  } catch (error) {
    console.error('DELETE RESTAURANT ERROR =>', error);
    return res.status(500).json({ success: false, message: error.message || 'Impossible de supprimer le restaurant.' });
  }
};

module.exports = {
  getNearbyRestaurants,
  getRestaurants,
  getMyRestaurant,
  getRestaurantById,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
};
