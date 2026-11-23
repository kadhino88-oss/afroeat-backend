'use strict';

// Projection publique d'un commerce : liste blanche explicite.
// Jamais de donnée du propriétaire (e-mail, téléphone, rôle, statut, identité),
// ni de statistiques commerciales (chiffre d'affaires, nombre de commandes…),
// ni de réglages internes (acceptation auto, notifications…).
const PUBLIC_RESTAURANT_FIELDS = [
  'name', 'description', 'cuisine', 'businessType', 'categories',
  'image', 'coverImage', 'logo', 'phone',
  'address', 'city', 'country', 'postalCode',
  'currency', 'deliveryFee', 'minimumOrderAmount', 'averagePreparationTimeMinutes',
  'ratingAverage', 'ratingCount',
  'isOpen', 'selfDelivery', 'pickupEnabled', 'isFeatured', 'isActive',
  'openingHours', 'latitude', 'longitude',
];

const PUBLIC_MENU_ITEM_FIELDS = [
  'restaurant', 'name', 'description', 'story', 'price', 'image', 'imageIsIllustration',
  'category', 'cuisine', 'containsAlcohol', 'isPopular', 'isRecommended', 'available',
];

const pick = (source, fields) => {
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
};

const toPublicMenuItem = (item) => {
  if (!item || typeof item !== 'object') return null;
  const plain = typeof item.toObject === 'function' ? item.toObject() : item;
  return { _id: plain._id, id: plain._id, ...pick(plain, PUBLIC_MENU_ITEM_FIELDS) };
};

const toPublicRestaurant = (restaurantDoc, menuItems = [], extra = {}) => {
  if (!restaurantDoc) return null;
  const restaurant = typeof restaurantDoc.toObject === 'function'
    ? restaurantDoc.toObject({ virtuals: false })
    : restaurantDoc;

  const menus = (Array.isArray(menuItems) ? menuItems : []).map(toPublicMenuItem).filter(Boolean);
  const categories = [...new Set(menus.map((i) => String(i.category || '').trim()).filter(Boolean))];

  const out = {
    _id: restaurant._id,
    id: restaurant._id,
    ...pick(restaurant, PUBLIC_RESTAURANT_FIELDS),
    menu: menus,
    menus,
    categories: categories.length ? categories : (Array.isArray(restaurant.categories) ? restaurant.categories : []),
    ...extra,
  };
  if (restaurant.location && typeof restaurant.location === 'object') {
    out.location = { latitude: restaurant.location.latitude ?? null, longitude: restaurant.location.longitude ?? null };
  }
  return out;
};

module.exports = { toPublicRestaurant, toPublicMenuItem, PUBLIC_RESTAURANT_FIELDS };
