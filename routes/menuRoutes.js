const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const normalizeString = (value) => String(value || '').trim();
const normalizeLowerString = (value) => normalizeString(value).toLowerCase();

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;

  const normalized = normalizeLowerString(value);

  if (['true', '1', 'yes', 'oui'].includes(normalized)) return true;
  if (['false', '0', 'no', 'non'].includes(normalized)) return false;

  return fallback;
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const sanitizeMenuPayload = (body = {}) => {
  const payload = { ...body };

  if (payload.name !== undefined) payload.name = normalizeString(payload.name);
  if (payload.description !== undefined) {
    payload.description = normalizeString(payload.description);
  }
  if (payload.image !== undefined) payload.image = normalizeString(payload.image);
  if (payload.category !== undefined) payload.category = normalizeString(payload.category);
  if (payload.cuisine !== undefined) payload.cuisine = normalizeString(payload.cuisine);

  if (payload.price !== undefined) {
    payload.price = Number(normalizeNumber(payload.price, NaN).toFixed(2));
  }

  if (payload.available !== undefined) {
    payload.available = normalizeBoolean(payload.available, true);
  }

  if (payload.isPopular !== undefined) {
    payload.isPopular = normalizeBoolean(payload.isPopular, false);
  }

  if (payload.isRecommended !== undefined) {
    payload.isRecommended = normalizeBoolean(payload.isRecommended, false);
  }

  return payload;
};

const buildMenuResponse = (items = [], extra = {}) => {
  const safeItems = Array.isArray(items) ? items : [];

  return {
    success: true,
    count: safeItems.length,
    menuItems: safeItems,
    items: safeItems,
    ...extra,
  };
};

const findOwnedRestaurant = async (userId) => {
  return Restaurant.findOne({ owner: userId }).select('_id owner name menu menus');
};

const dedupeMenuItems = (items = []) => {
  const seen = new Map();

  for (const item of toArray(items)) {
    if (!item) continue;

    const key = String(
      item?._id ||
        item?.id ||
        `${normalizeString(item?.name)}-${normalizeString(item?.category)}-${normalizeNumber(item?.price, 0)}`
    );

    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
};

const normalizeFallbackMenuItem = (item, restaurant) => {
  if (!item || typeof item !== 'object') return null;

  return {
    ...item,
    _id: item?._id || item?.id || new mongoose.Types.ObjectId(),
    id: item?.id || item?._id || undefined,
    name: normalizeString(item?.name || item?.title),
    description: normalizeString(item?.description),
    image: normalizeString(item?.image),
    category: normalizeString(item?.category || 'Plats principaux'),
    cuisine: normalizeString(item?.cuisine || restaurant?.cuisine),
    price: normalizeNumber(item?.price, 0),
    available:
      item?.available === undefined ? true : normalizeBoolean(item?.available, true),
    isPopular: normalizeBoolean(item?.isPopular, false),
    isRecommended: normalizeBoolean(item?.isRecommended, false),
    restaurant: restaurant?._id,
  };
};

const getEmbeddedRestaurantMenu = (restaurantDoc) => {
  if (!restaurantDoc) return [];

  const restaurant =
    typeof restaurantDoc.toObject === 'function'
      ? restaurantDoc.toObject({ virtuals: true })
      : { ...restaurantDoc };

  if (Array.isArray(restaurant?.menu) && restaurant.menu.length > 0) {
    return restaurant.menu;
  }

  if (Array.isArray(restaurant?.menus) && restaurant.menus.length > 0) {
    return restaurant.menus;
  }

  return [];
};

const getRestaurantOr404 = async (restaurantId, res) => {
  if (!restaurantId || !isValidObjectId(restaurantId)) {
    res.status(400).json({
      success: false,
      message: 'ID restaurant invalide.',
    });
    return null;
  }

  const restaurant = await Restaurant.findById(restaurantId)
    .select('_id owner name cuisine address image coverImage menu menus');

  if (!restaurant) {
    res.status(404).json({
      success: false,
      message: 'Restaurant introuvable.',
    });
    return null;
  }

  return restaurant;
};

const buildMenuFilterFromQuery = ({ available, includeUnavailable, category, restaurant, restaurantId, cuisine, popular, recommended }) => {
  const filter = {};

  const targetRestaurantId = restaurant || restaurantId;

  if (targetRestaurantId) {
    filter.restaurant = targetRestaurantId;
  }

  if (includeUnavailable !== 'true') {
    if (available === 'false') {
      filter.available = false;
    } else {
      filter.available = true;
    }
  }

  if (category) {
    filter.category = { $regex: normalizeString(category), $options: 'i' };
  }

  if (cuisine) {
    filter.cuisine = { $regex: normalizeString(cuisine), $options: 'i' };
  }

  if (popular === 'true') {
    filter.isPopular = true;
  }

  if (recommended === 'true') {
    filter.isRecommended = true;
  }

  return filter;
};

const getMenuItemsFromDb = async (filter = {}) => {
  return MenuItem.find(filter)
    .populate('restaurant', 'name cuisine address image coverImage')
    .sort({ category: 1, isPopular: -1, isRecommended: -1, createdAt: -1 });
};

const canManageRestaurant = async (req, res, next) => {
  try {
    let restaurantId =
      req.body.restaurant ||
      req.body.restaurantId ||
      req.params.restaurantId ||
      req.query.restaurant ||
      req.query.restaurantId;

    let restaurant = null;

    if (
      req.user.role === 'restaurant' &&
      (!restaurantId || !isValidObjectId(restaurantId))
    ) {
      restaurant = await findOwnedRestaurant(req.user._id);

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message: 'Restaurant introuvable.',
        });
      }

      req.restaurant = restaurant;
      req.body.restaurant = restaurant._id.toString();
      return next();
    }

    if (!restaurantId || !isValidObjectId(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: 'ID restaurant invalide.',
      });
    }

    restaurant = await Restaurant.findById(restaurantId).select('_id owner name menu menus');

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant introuvable.',
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner =
      restaurant.owner &&
      restaurant.owner.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Vous n’avez pas le droit de gérer ce restaurant.',
      });
    }

    req.restaurant = restaurant;
    req.body.restaurant = restaurant._id.toString();

    return next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

const canManageMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID plat invalide.',
      });
    }

    const item = await MenuItem.findById(id).populate('restaurant', 'owner name');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Plat introuvable.',
      });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner =
      item.restaurant &&
      item.restaurant.owner &&
      item.restaurant.owner.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Vous n’avez pas le droit de gérer ce plat.',
      });
    }

    req.menuItem = item;
    return next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur.',
    });
  }
};

/**
 * =========================================================
 * CREATE MENU ITEM
 * =========================================================
 */
router.post(
  '/',
  protect,
  allowRoles('admin', 'restaurant'),
  canManageRestaurant,
  async (req, res) => {
    try {
      const payload = sanitizeMenuPayload(req.body);

      const {
        restaurant,
        name,
        description,
        price,
        image,
        category,
        cuisine,
        available,
        isPopular,
        isRecommended,
      } = payload;

      if (!restaurant || !name || price === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Les champs restaurant, name et price sont obligatoires.',
        });
      }

      if (!isValidObjectId(restaurant)) {
        return res.status(400).json({
          success: false,
          message: 'ID restaurant invalide.',
        });
      }

      if (name.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Le nom du plat est trop court.',
        });
      }

      if (Number.isNaN(price) || price < 0) {
        return res.status(400).json({
          success: false,
          message: 'Le prix doit être un nombre valide.',
        });
      }

      const menuItem = new MenuItem({
        restaurant,
        name,
        description: description || '',
        price,
        image: image || '',
        category: category || 'Plats principaux',
        cuisine: cuisine || '',
        available: available !== undefined ? available : true,
        isPopular: isPopular !== undefined ? isPopular : false,
        isRecommended: isRecommended !== undefined ? isRecommended : false,
      });

      await menuItem.save();

      const populatedMenuItem = await MenuItem.findById(menuItem._id).populate(
        'restaurant',
        'name cuisine address image coverImage owner'
      );

      return res.status(201).json({
        success: true,
        message: 'Plat ajouté avec succès',
        menuItem: populatedMenuItem,
        item: populatedMenuItem,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l’ajout du plat',
        error: error.message,
      });
    }
  }
);

/**
 * =========================================================
 * GET ALL MENU ITEMS
 * =========================================================
 *
 * Supporte :
 * - ?restaurant=
 * - ?restaurantId=
 * - ?available=true|false
 * - ?includeUnavailable=true
 * - ?category=
 * - ?cuisine=
 * - ?popular=true
 * - ?recommended=true
 */
router.get('/', async (req, res) => {
  try {
    const {
      available,
      includeUnavailable,
      category,
      restaurant,
      restaurantId,
      cuisine,
      popular,
      recommended,
    } = req.query;

    const targetRestaurantId = restaurant || restaurantId;

    if (targetRestaurantId && !isValidObjectId(targetRestaurantId)) {
      return res.status(400).json({
        success: false,
        message: 'ID restaurant invalide.',
      });
    }

    let restaurantDoc = null;

    if (targetRestaurantId) {
      restaurantDoc = await getRestaurantOr404(targetRestaurantId, res);
      if (!restaurantDoc) return;
    }

    const filter = buildMenuFilterFromQuery({
      available,
      includeUnavailable,
      category,
      restaurant,
      restaurantId,
      cuisine,
      popular,
      recommended,
    });

    let items = await getMenuItemsFromDb(filter);

    /**
     * Fallback important :
     * si aucun MenuItem n’est trouvé mais que le restaurant embarque encore
     * ses plats dans restaurant.menu / restaurant.menus,
     * on les renvoie aussi pour ne pas casser le front.
     */
    if (targetRestaurantId && items.length === 0 && restaurantDoc) {
      const embeddedMenu = getEmbeddedRestaurantMenu(restaurantDoc)
        .map((item) => normalizeFallbackMenuItem(item, restaurantDoc))
        .filter(Boolean);

      let fallbackItems = embeddedMenu;

      if (includeUnavailable !== 'true') {
        if (available === 'false') {
          fallbackItems = fallbackItems.filter((item) => item.available === false);
        } else {
          fallbackItems = fallbackItems.filter((item) => item.available !== false);
        }
      }

      if (category) {
        fallbackItems = fallbackItems.filter((item) =>
          normalizeLowerString(item.category).includes(normalizeLowerString(category))
        );
      }

      if (cuisine) {
        fallbackItems = fallbackItems.filter((item) =>
          normalizeLowerString(item.cuisine).includes(normalizeLowerString(cuisine))
        );
      }

      if (popular === 'true') {
        fallbackItems = fallbackItems.filter((item) => item.isPopular === true);
      }

      if (recommended === 'true') {
        fallbackItems = fallbackItems.filter((item) => item.isRecommended === true);
      }

      items = fallbackItems;
    }

    const safeItems = dedupeMenuItems(items);

    return res.status(200).json(
      buildMenuResponse(safeItems, {
        restaurantId: targetRestaurantId || null,
      })
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des plats',
      error: error.message,
    });
  }
});

/**
 * =========================================================
 * GET MENU ITEMS BY RESTAURANT
 * =========================================================
 */
router.get('/restaurant/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { includeUnavailable, available, category, cuisine, popular, recommended } = req.query;

  try {
    const restaurantDoc = await getRestaurantOr404(restaurantId, res);
    if (!restaurantDoc) return;

    const filter = buildMenuFilterFromQuery({
      available,
      includeUnavailable,
      category,
      restaurantId,
      cuisine,
      popular,
      recommended,
    });

    let items = await getMenuItemsFromDb(filter);

    if (items.length === 0) {
      const embeddedMenu = getEmbeddedRestaurantMenu(restaurantDoc)
        .map((item) => normalizeFallbackMenuItem(item, restaurantDoc))
        .filter(Boolean);

      let fallbackItems = embeddedMenu;

      if (includeUnavailable !== 'true') {
        if (available === 'false') {
          fallbackItems = fallbackItems.filter((item) => item.available === false);
        } else {
          fallbackItems = fallbackItems.filter((item) => item.available !== false);
        }
      }

      if (category) {
        fallbackItems = fallbackItems.filter((item) =>
          normalizeLowerString(item.category).includes(normalizeLowerString(category))
        );
      }

      if (cuisine) {
        fallbackItems = fallbackItems.filter((item) =>
          normalizeLowerString(item.cuisine).includes(normalizeLowerString(cuisine))
        );
      }

      if (popular === 'true') {
        fallbackItems = fallbackItems.filter((item) => item.isPopular === true);
      }

      if (recommended === 'true') {
        fallbackItems = fallbackItems.filter((item) => item.isRecommended === true);
      }

      items = fallbackItems;
    }

    const safeItems = dedupeMenuItems(items);

    return res.status(200).json(
      buildMenuResponse(safeItems, {
        restaurantId,
      })
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des plats du restaurant',
      error: error.message,
    });
  }
});

/**
 * =========================================================
 * GET ONE MENU ITEM
 * =========================================================
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID plat invalide.',
      });
    }

    const item = await MenuItem.findById(id).populate(
      'restaurant',
      'name cuisine address image coverImage owner'
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Plat introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      menuItem: item,
      item,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du plat',
      error: error.message,
    });
  }
});

/**
 * =========================================================
 * UPDATE MENU ITEM
 * =========================================================
 */
router.put(
  '/:id',
  protect,
  allowRoles('admin', 'restaurant'),
  canManageMenuItem,
  async (req, res) => {
    try {
      const payload = sanitizeMenuPayload(req.body);

      if (payload.price !== undefined) {
        if (Number.isNaN(payload.price) || payload.price < 0) {
          return res.status(400).json({
            success: false,
            message: 'Le prix doit être un nombre valide.',
          });
        }
      }

      if (payload.name !== undefined && payload.name.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Le nom du plat est trop court.',
        });
      }

      if (req.user.role !== 'admin') {
        delete payload.restaurant;
      }

      const updatedItem = await MenuItem.findByIdAndUpdate(
        req.menuItem._id,
        payload,
        {
          new: true,
          runValidators: true,
        }
      ).populate('restaurant', 'name cuisine address image coverImage owner');

      return res.status(200).json({
        success: true,
        message: 'Plat mis à jour avec succès',
        menuItem: updatedItem,
        item: updatedItem,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour du plat',
        error: error.message,
      });
    }
  }
);

/**
 * =========================================================
 * DELETE MENU ITEM
 * =========================================================
 */
router.delete(
  '/:id',
  protect,
  allowRoles('admin', 'restaurant'),
  canManageMenuItem,
  async (req, res) => {
    try {
      await MenuItem.findByIdAndDelete(req.menuItem._id);

      return res.status(200).json({
        success: true,
        message: 'Plat supprimé avec succès',
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression du plat',
        error: error.message,
      });
    }
  }
);

module.exports = router;