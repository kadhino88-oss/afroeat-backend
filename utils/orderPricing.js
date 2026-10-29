'use strict';

const normalizeString = (value) => String(value ?? '').trim();
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Build order items from persisted menu records. Client-provided prices, names,
 * and images are intentionally never copied into the saved order.
 * Returns null if any requested menu item or persisted price is invalid.
 */
const priceRequestedOrderItems = (requestedItems, menuItems) => {
  if (!Array.isArray(requestedItems) || !Array.isArray(menuItems)) return null;

  const menuById = new Map(menuItems.map((item) => [String(item._id), item]));
  const requestedIds = [...new Set(requestedItems.map((item) => String(item.menuItem)))];
  if (requestedIds.some((id) => !menuById.has(id))) return null;

  const items = [];
  for (const requestedItem of requestedItems) {
    const menuItem = menuById.get(String(requestedItem.menuItem));
    const price = Number(menuItem.price);
    if (!Number.isFinite(price) || price < 0 || !normalizeString(menuItem.name)) return null;

    items.push({
      menuItem: menuItem._id,
      name: normalizeString(menuItem.name),
      quantity: requestedItem.quantity,
      price: roundMoney(price),
      image: normalizeString(menuItem.image),
      notes: normalizeString(requestedItem.notes).slice(0, 300),
    });
  }

  const itemsSubtotal = roundMoney(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
  return { items, itemsSubtotal };
};

module.exports = { priceRequestedOrderItems };
