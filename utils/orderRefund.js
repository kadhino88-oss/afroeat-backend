'use strict';

// Remboursement automatique d'une commande payée par carte puis annulée avant livraison.
// Le statut « Remboursé » est posé par le webhook Stripe (charge.refunded), pas ici.

const shouldRefund = (order) =>
  Boolean(
    order &&
      order.status === 'Annulée' &&
      order.paymentStatus === 'Payé' &&
      order.stripePaymentIntentId &&
      !order.refundedAt &&
      !order.refundRequestedAt
  );

const refundCancelledOrder = async (order, stripe) => {
  if (!shouldRefund(order)) return { refunded: false, reason: 'not_applicable' };
  if (!stripe) return { refunded: false, reason: 'stripe_unavailable' };

  try {
    await stripe.refunds.create(
      { payment_intent: order.stripePaymentIntentId, reason: 'requested_by_customer', metadata: { orderId: String(order._id) } },
      { idempotencyKey: `refund_order_${order._id}` }
    );
    order.refundRequestedAt = new Date();
    order.refundError = '';
    await order.save();
    return { refunded: true };
  } catch (error) {
    // L'échec est conservé pour l'administration (relance manuelle possible).
    order.refundError = String(error?.message || 'Remboursement impossible').slice(0, 300);
    await order.save().catch(() => {});
    return { refunded: false, reason: 'error', error: order.refundError };
  }
};

module.exports = { shouldRefund, refundCancelledOrder };
