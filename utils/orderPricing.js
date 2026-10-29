'use strict';

const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 50;
const SUPPORTED_CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CHF', 'XOF', 'XAF', 'CAD']);

const roundMoney = (value) => Number(Number(value).toFixed(2));

const idToString = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value._id !== undefined && value._id !== null) return String(value._id);
    if (value.id !== undefined && value.id !== null) return String(value.id);
    if (typeof value.toString === 'function') {
      const stringValue = value.toString();
      return stringValue === '[object Object]' ? '' : stringValue;
    }
    return '';
  }
  return String(value).trim();
};

const resultError = (code, message, details = {}) => ({
  ok: false,
  code,
  message,
  ...details,
});

const normalizeRequestedOrderItems = (items, isValidObjectId = () => true) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_ITEMS) {
    return resultError(
      'INVALID_ORDER_ITEMS',
      `Une commande doit contenir entre 1 et ${MAX_ORDER_ITEMS} articles.`
    );
  }

  const normalizedItems = [];
  for (const item of items) {
    const rawId =
      item?.menuItem?._id ||
      item?.menuItem?.id ||
      item?.menuItemId ||
      item?.productId ||
      item?.dishId ||
      item?.menuItem ||
      item?._id ||
      item?.id;
    const menuItem = idToString(rawId);

    if (!menuItem || !isValidObjectId(menuItem)) {
      return resultError('INVALID_MENU_ITEM_ID', 'Un article du panier possède un identifiant invalide.');
    }

    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return resultError(
        'INVALID_ITEM_QUANTITY',
        `La quantité de chaque article doit être un entier entre 1 et ${MAX_ITEM_QUANTITY}.`
      );
    }

    const notes = String(item?.notes || item?.specialInstructions || '').trim();
    if (notes.length > 300) {
      return resultError('INVALID_ITEM_NOTES', 'Les instructions d’un article ne peuvent pas dépasser 300 caractères.');
    }

    normalizedItems.push({ menuItem, quantity, notes });
  }

  return {
    ok: true,
    items: normalizedItems,
    menuItemIds: [...new Set(normalizedItems.map((item) => item.menuItem))],
  };
};

const buildTrustedOrderItems = ({ requestedItems, menuItems, restaurantId }) => {
  if (!Array.isArray(requestedItems) || !Array.isArray(menuItems)) {
    return resultError('INVALID_ORDER_ITEMS', 'Les articles de la commande sont invalides.');
  }

  const trustedRestaurantId = idToString(restaurantId);
  const menuById = new Map(
    menuItems.map((item) => [idToString(item?._id), item])
  );
  const normalizedItems = [];

  for (const requested of requestedItems) {
    const menuItemId = idToString(requested?.menuItem);
    const menuItem = menuById.get(menuItemId);

    if (
      !menuItem ||
      idToString(menuItem.restaurant) !== trustedRestaurantId ||
      menuItem.available === false
    ) {
      return resultError(
        'MENU_ITEM_UNAVAILABLE',
        'Un ou plusieurs plats ne sont plus disponibles dans ce restaurant.'
      );
    }

    const quantity = Number(requested.quantity);
    const price = Number(menuItem.price);
    const name = String(menuItem.name || '').trim();
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_ITEM_QUANTITY ||
      !name ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return resultError(
        'INVALID_MENU_ITEM_DATA',
        'Les données serveur d’un plat ne sont pas valides.'
      );
    }

    normalizedItems.push({
      menuItem: menuItemId,
      name,
      quantity,
      price: roundMoney(price),
      image: String(menuItem.image || '').trim(),
      notes: String(requested.notes || '').trim(),
    });
  }

  const subtotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );

  return { ok: true, items: normalizedItems, subtotal };
};

const calculateRestaurantPricing = ({ items, restaurant }) => {
  if (!Array.isArray(items) || items.length === 0 || !restaurant) {
    return resultError('INVALID_ORDER_PRICING', 'Impossible de calculer le montant de la commande.');
  }

  const currency = String(restaurant.currency || 'EUR').trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    return resultError('UNSUPPORTED_CURRENCY', 'La devise du restaurant n’est pas prise en charge.');
  }

  const rawDeliveryFee = Number(restaurant.deliveryFee ?? 0);
  const rawMinimum = Number(restaurant.minimumOrderAmount ?? 0);
  if (
    !Number.isFinite(rawDeliveryFee) ||
    rawDeliveryFee < 0 ||
    !Number.isFinite(rawMinimum) ||
    rawMinimum < 0
  ) {
    return resultError('INVALID_RESTAURANT_PRICING', 'Les frais ou le minimum de commande du restaurant sont invalides.');
  }

  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0)
  );
  const deliveryFee = roundMoney(rawDeliveryFee);
  const minimumOrderAmount = roundMoney(rawMinimum);

  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return resultError('INVALID_ORDER_PRICING', 'Le sous-total de la commande est invalide.');
  }

  if (subtotal < minimumOrderAmount) {
    return resultError(
      'MINIMUM_ORDER_NOT_MET',
      `Le montant minimum pour ce restaurant est ${minimumOrderAmount.toFixed(2)} ${currency}.`,
      { subtotal, minimumOrderAmount, currency }
    );
  }

  return {
    ok: true,
    subtotal,
    deliveryFee,
    minimumOrderAmount,
    totalPrice: roundMoney(subtotal + deliveryFee),
    driverEarning: deliveryFee,
    currency,
  };
};

module.exports = {
  MAX_ORDER_ITEMS,
  MAX_ITEM_QUANTITY,
  normalizeRequestedOrderItems,
  buildTrustedOrderItems,
  calculateRestaurantPricing,
};
