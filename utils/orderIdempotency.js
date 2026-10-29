'use strict';

const crypto = require('node:crypto');

const normalizeIdempotencyKey = (rawValue) => {
  if (rawValue === null || rawValue === undefined || String(rawValue) === '') {
    return { ok: true, key: null };
  }

  const raw = String(rawValue);
  if (/[\r\n]/.test(raw)) {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Clé de requête invalide.',
    };
  }

  const key = raw.trim();
  if (!key) return { ok: true, key: null };

  if (key.length > 128) {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'La clé de requête ne peut pas dépasser 128 caractères.',
    };
  }

  return { ok: true, key };
};

const createOrderRequestFingerprint = ({
  restaurant,
  items,
  deliveryAddress,
  notes = '',
}) => {
  const canonicalPayload = {
    restaurant: String(restaurant || '').trim(),
    items: (Array.isArray(items) ? items : []).map((item) => ({
      menuItem: String(item?.menuItem || '').trim(),
      quantity: Number(item?.quantity),
      notes: String(item?.notes || '').trim().slice(0, 300),
    })),
    deliveryAddress: String(deliveryAddress || '').trim(),
    notes: String(notes || '').trim().slice(0, 500),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
};

module.exports = {
  normalizeIdempotencyKey,
  createOrderRequestFingerprint,
};
