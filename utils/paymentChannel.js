'use strict';

const PAYMENT_CHANNELS = new Set(['card', 'stripe_checkout']);

const evaluatePaymentChannel = (order, requestedChannel) => {
  if (!order || !PAYMENT_CHANNELS.has(requestedChannel)) {
    return {
      allowed: false,
      code: 'INVALID_PAYMENT_CHANNEL',
      message: 'Moyen de paiement invalide.',
    };
  }

  const currentMethod = String(order.paymentMethod || '').trim().toLowerCase();
  if (currentMethod && currentMethod !== requestedChannel) {
    return {
      allowed: false,
      code: 'PAYMENT_METHOD_LOCKED',
      message: 'Un autre moyen de paiement a déjà été préparé pour cette commande. Reprends le parcours de paiement choisi.',
    };
  }

  if (requestedChannel === 'card' && order.stripeCheckoutSessionId) {
    return {
      allowed: false,
      code: 'PAYMENT_METHOD_LOCKED',
      message: 'Une session Checkout existe déjà pour cette commande.',
    };
  }

  if (requestedChannel === 'stripe_checkout' && order.stripePaymentIntentId) {
    return {
      allowed: false,
      code: 'PAYMENT_METHOD_LOCKED',
      message: 'Un paiement par carte existe déjà pour cette commande.',
    };
  }

  return { allowed: true, code: null, message: '' };
};

module.exports = { evaluatePaymentChannel };
