'use strict';

const Order = require('../models/Order');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

const isConnectPayoutsEnabled = () =>
  String(process.env.STRIPE_CONNECT_PAYOUTS_ENABLED || '').trim().toLowerCase() === 'true';

const listCountryCodes = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim().toUpperCase())
  .filter((entry) => /^[A-Z]{2}$/.test(entry));

const isTransferCountryAllowed = (countryCode, env = process.env) => {
  const country = String(countryCode || '').trim().toUpperCase();
  const platformCountry = String(env.STRIPE_PLATFORM_COUNTRY || '').trim().toUpperCase();
  const allowedCountries = listCountryCodes(env.STRIPE_CONNECT_COUNTRIES);
  const crossBorderCountries = listCountryCodes(env.STRIPE_CONNECT_CROSS_BORDER_COUNTRIES);

  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{2}$/.test(platformCountry)) return false;
  if (!allowedCountries.includes(country)) return false;
  return country === platformCountry || crossBorderCountries.includes(country);
};

const getStripe = () => {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY est manquant.');
  return require('stripe')(secretKey);
};

const toStripeAmount = (amount, currency) => {
  const code = String(currency || '').trim().toUpperCase();
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'XOF', 'XAF'].includes(code)) return null;
  const minorUnits = Math.round(value * (code === 'XOF' || code === 'XAF' ? 1 : 100));
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : null;
};

const isPartnerReadyForTransfers = (user) => {
  if (!user?.stripeConnectAccountId ||
      !user?.stripeConnectTransfersEnabled ||
      !user?.stripeConnectPayoutsEnabled) {
    return false;
  }
  if (!isConnectPayoutsEnabled()) return true;
  return isTransferCountryAllowed(user.countryCode);
};

const getOrderRestaurantOwner = async (order) => {
  const restaurantId = order?.restaurant?._id || order?.restaurant;
  if (!restaurantId) return null;
  const restaurant = await Restaurant.findById(restaurantId).select('owner name');
  if (!restaurant?.owner) return null;
  // Country is required by the allow-list for cross-border transfers.
  return User.findById(restaurant.owner).select(
    '_id countryCode stripeConnectAccountId stripeConnectTransfersEnabled stripeConnectPayoutsEnabled'
  );
};

const markReconciliationRequired = async (order, message) => {
  order.payoutStatus = 'reconciliation_required';
  order.payoutError = String(message || 'Rapprochement manuel requis.').slice(0, 500);
  order.payoutUpdatedAt = new Date();
  await order.save();
};

const createTransfer = async ({ order, stripe, owner, amount, kind, chargeId }) => {
  if (amount <= 0) return null;
  const destination = owner?.stripeConnectAccountId;
  if (!destination || !isPartnerReadyForTransfers(owner)) {
    throw new Error('Le compte de versement ' + kind + ' n’est pas activé.');
  }

  const amountMinor = toStripeAmount(amount, order.currency);
  if (!amountMinor) {
    throw new Error('Le montant ou la devise du versement ' + kind + ' est invalide.');
  }

  const field = kind === 'restaurant' ? 'stripeRestaurantTransferId' : 'stripeCourierTransferId';
  if (order[field]) return order[field];

  const transfer = await stripe.transfers.create(
    {
      amount: amountMinor,
      currency: String(order.currency || '').toLowerCase(),
      destination,
      source_transaction: chargeId,
      transfer_group: 'afroeat_order_' + order._id.toString(),
      metadata: {
        orderId: order._id.toString(),
        payoutType: kind,
        platform: 'afroeat',
      },
    },
    { idempotencyKey: 'afroeat_' + kind + '_transfer_' + order._id.toString() }
  );

  order[field] = transfer.id;
  order.payoutUpdatedAt = new Date();
  await order.save();
  return transfer.id;
};

const createDeliveredOrderTransfers = async (orderId) => {
  if (!isConnectPayoutsEnabled()) return { skipped: true, reason: 'connect_disabled' };

  const order = await Order.findById(orderId);
  if (!order) return { skipped: true, reason: 'order_missing' };
  if (order.status !== 'Livrée') return { skipped: true, reason: 'not_delivered' };
  if (order.payoutStatus === 'manually_reconciled') {
    return { success: true, payoutStatus: order.payoutStatus };
  }
  if (order.paymentMethod === 'cash') {
    order.payoutStatus = 'not_applicable';
    order.payoutError = 'Commande encaissée en espèces : règlement hors Stripe à rapprocher.';
    order.payoutUpdatedAt = new Date();
    await order.save();
    return { skipped: true, reason: 'cash_order' };
  }
  if (order.payoutStatus === 'reversed') return { skipped: true, reason: 'already_reversed' };

  if (order.paymentStatus === 'Remboursé') {
    if (order.stripeRestaurantTransferId || order.stripeCourierTransferId) {
      await markReconciliationRequired(order, 'Remboursement confirmé : les transferts doivent être réversés.');
      return { success: false, reason: 'refund_reversal_required' };
    }
    order.payoutStatus = 'reversed';
    order.payoutError = '';
    order.payoutUpdatedAt = new Date();
    await order.save();
    return { success: true, reason: 'refunded_before_transfer' };
  }
  if (order.stripeDisputeId && !order.stripeDisputeClosedAt) {
    await markReconciliationRequired(order, 'Litige Stripe ouvert : versement suspendu jusqu’au rapprochement.');
    return { success: false, reason: 'open_dispute' };
  }
  if (Number(order.stripeAmountRefunded || 0) > 0) {
    await markReconciliationRequired(order, 'Remboursement partiel enregistré : versement suspendu pour rapprochement manuel.');
    return { success: false, reason: 'partial_refund' };
  }
  if (!['card', 'stripe_checkout'].includes(order.paymentMethod) || order.paymentStatus !== 'Payé') {
    await markReconciliationRequired(order, 'Commande livrée sans paiement carte confirmé.');
    return { success: false, reason: 'payment_not_confirmed' };
  }
  if (order.payoutStatus === 'transferred') {
    return { success: true, payoutStatus: order.payoutStatus };
  }

  try {
    const restaurantOwner = await getOrderRestaurantOwner(order);
    const courier = order.deliveryPerson
      ? await User.findById(order.deliveryPerson).select(
          '_id countryCode stripeConnectAccountId stripeConnectTransfersEnabled stripeConnectPayoutsEnabled'
        )
      : null;

    if (Number(order.restaurantEarning || 0) > 0 && !isPartnerReadyForTransfers(restaurantOwner)) {
      throw new Error('Le compte de versement du restaurant n’est pas activé.');
    }
    if (Number(order.driverEarning || 0) > 0 && !isPartnerReadyForTransfers(courier)) {
      throw new Error('Le compte de versement du livreur n’est pas activé.');
    }
    if (!order.stripePaymentIntentId) throw new Error('PaymentIntent absent pour cette commande.');

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
      expand: ['latest_charge'],
    });
    if (intent.status !== 'succeeded') throw new Error('Le paiement Stripe n’est pas finalisé.');
    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id;
    if (!chargeId) throw new Error('Charge Stripe introuvable pour cette commande.');

    order.payoutStatus = 'processing';
    order.payoutError = '';
    order.payoutUpdatedAt = new Date();
    await order.save();

    await createTransfer({
      order, stripe, owner: restaurantOwner,
      amount: Number(order.restaurantEarning || 0), kind: 'restaurant', chargeId,
    });
    await createTransfer({
      order, stripe, owner: courier,
      amount: Number(order.driverEarning || 0), kind: 'courier', chargeId,
    });

    order.payoutStatus = order.stripeRestaurantTransferId || order.stripeCourierTransferId
      ? 'transferred'
      : 'not_applicable';
    order.payoutError = '';
    order.payoutUpdatedAt = new Date();
    await order.save();
    return { success: true, payoutStatus: order.payoutStatus };
  } catch (error) {
    await markReconciliationRequired(order, error?.message);
    console.error('STRIPE CONNECT TRANSFER ERROR =>', {
      orderId: String(order._id), message: error?.message, code: error?.code,
    });
    return { success: false, reason: 'transfer_failed' };
  }
};

const reverseOrderTransfers = async (order, charge) => {
  if (order.payoutStatus === 'manually_reconciled') {
    return { success: true, reason: 'manually_reconciled' };
  }
  if (!order.stripeRestaurantTransferId && !order.stripeCourierTransferId) {
    order.payoutStatus = 'reversed';
    order.payoutError = '';
    order.payoutUpdatedAt = new Date();
    await order.save();
    return { success: true };
  }

  if (Number(charge?.amount_refunded || 0) < Number(charge?.amount || 0)) {
    await markReconciliationRequired(
      order,
      'Remboursement partiel : les transferts doivent être rapprochés manuellement.'
    );
    return { success: false, reason: 'partial_refund' };
  }

  try {
    const stripe = getStripe();
    for (const [field, reversalField, kind] of [
      ['stripeRestaurantTransferId', 'stripeRestaurantReversalId', 'restaurant'],
      ['stripeCourierTransferId', 'stripeCourierReversalId', 'courier'],
    ]) {
      if (!order[field] || order[reversalField]) continue;
      const reversal = await stripe.transfers.createReversal(
        order[field],
        { metadata: { orderId: order._id.toString(), payoutType: kind, platform: 'afroeat' } },
        { idempotencyKey: 'afroeat_' + kind + '_reversal_' + order._id.toString() }
      );
      order[reversalField] = reversal.id;
      order.payoutUpdatedAt = new Date();
      await order.save();
    }
    order.payoutStatus = 'reversed';
    order.payoutError = '';
    order.payoutUpdatedAt = new Date();
    await order.save();
    return { success: true };
  } catch (error) {
    await markReconciliationRequired(
      order,
      'Réversion de transfert à reprendre : ' + (error?.message || 'erreur Stripe')
    );
    console.error('STRIPE CONNECT REVERSAL ERROR =>', {
      orderId: String(order._id), message: error?.message, code: error?.code,
    });
    return { success: false, reason: 'reversal_failed' };
  }
};

const reconcileOrderPayout = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) return { success: false, reason: 'order_missing' };
  if (order.status !== 'Livrée') return { success: false, reason: 'not_delivered' };
  if (order.payoutStatus === 'manually_reconciled') {
    return { success: true, payoutStatus: order.payoutStatus };
  }
  if (order.stripeDisputeId && !order.stripeDisputeClosedAt) {
    await markReconciliationRequired(order, 'Litige Stripe ouvert : examen manuel requis.');
    return { success: false, reason: 'open_dispute' };
  }
  if (order.paymentStatus === 'Remboursé') {
    if (!order.stripePaymentIntentId) {
      await markReconciliationRequired(order, 'PaymentIntent absent pour réverser les transferts remboursés.');
      return { success: false, reason: 'payment_intent_missing' };
    }
    try {
      const stripe = getStripe();
      const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
        expand: ['latest_charge'],
      });
      const charge = typeof intent.latest_charge === 'string'
        ? await stripe.charges.retrieve(intent.latest_charge)
        : intent.latest_charge;
      if (!charge) throw new Error('Charge Stripe introuvable.');
      return reverseOrderTransfers(order, charge);
    } catch (error) {
      await markReconciliationRequired(
        order,
        'Impossible de récupérer le remboursement Stripe : ' + (error?.message || 'erreur')
      );
      return { success: false, reason: 'refund_lookup_failed' };
    }
  }
  return createDeliveredOrderTransfers(order._id);
};

const flagOrderDispute = async (paymentIntentId, disputeId) => {
  const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
  if (!order) return null;
  order.payoutStatus = 'reconciliation_required';
  order.stripeDisputeId = String(disputeId || '');
  order.stripeDisputeClosedAt = null;
  order.payoutError = ('Litige Stripe à examiner : ' + String(disputeId || '')).slice(0, 500);
  order.payoutUpdatedAt = new Date();
  await order.save();
  return order;
};

module.exports = {
  isConnectPayoutsEnabled,
  isTransferCountryAllowed,
  isPartnerReadyForTransfers,
  createDeliveredOrderTransfers,
  reverseOrderTransfers,
  reconcileOrderPayout,
  flagOrderDispute,
  toStripeAmount,
};
