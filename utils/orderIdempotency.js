'use strict';

const crypto = require('crypto');

/**
 * Validate an Idempotency-Key before storing it.
 * Reject CR/LF to avoid header or log injection if reused downstream.
 */
const isValidIdempotencyKey = (key) =>
  typeof key === 'string' && key.length > 0 && key.length <= 128 && !/[\r\n]/.test(key);

/**
 * Fingerprint customer-controlled order inputs, not prices.
 * The backend calculates all prices from persisted restaurant/menu data.
 */
const createOrderRequestFingerprint = ({
  restaurant,
  items,
  deliveryAddress,
  notes,
} = {}) => {
  const canonicalRequest = {
    restaurant: String(restaurant ?? ''),
    items: (Array.isArray(items) ? items : []).map((item) => ({
      menuItem: item?.menuItem ?? null,
      quantity: item?.quantity ?? 0,
      notes: String(item?.notes ?? '').trim(),
    })),
    deliveryAddress: String(deliveryAddress ?? '').trim(),
    notes: String(notes ?? '').trim().slice(0, 500),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalRequest))
    .digest('hex');
};

module.exports = {
  createOrderRequestFingerprint,
  isValidIdempotencyKey,
};
