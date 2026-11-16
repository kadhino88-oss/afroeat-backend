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

// Un remboursement carte « succeeded » est définitif : on l'affiche tout de suite, sans attendre le webhook
// (qui reste idempotent et confirme ensuite).
const applyRefundResult = (order, refund) => {
  if (!refund || typeof refund !== 'object') return;
  if (refund.id) order.stripeRefundId = refund.id;
  if (refund.status === 'succeeded' && !order.refundedAt) {
    order.paymentStatus = 'Remboursé';
    order.refundedAt = new Date();
    if (Number.isFinite(refund.amount)) order.stripeAmountRefunded = refund.amount / 100;
  }
};

// Rattrape les remboursements demandés dont la confirmation n'est jamais arrivée (webhook manquant).
const reconcileRefunds = async ({ Order, stripe }) => {
  if (!stripe) return 0;
  const pending = await Order.find({
    status: 'Annulée',
    paymentStatus: 'Payé',
    refundRequestedAt: { $ne: null },
    refundedAt: null,
    stripePaymentIntentId: { $nin: ['', null] },
  }).limit(20);
  let done = 0;
  for (const order of pending) {
    try {
      const list = await stripe.refunds.list({ payment_intent: order.stripePaymentIntentId, limit: 1 });
      const refund = list?.data?.[0];
      if (refund?.status === 'succeeded') {
        applyRefundResult(order, refund);
        await order.save();
        done += 1;
      }
    } catch (error) {
      console.error('Rapprochement remboursement :', error.message);
    }
  }
  return done;
};

const refundCancelledOrder = async (order, stripe) => {
  if (!shouldRefund(order)) return { refunded: false, reason: 'not_applicable' };
  if (!stripe) return { refunded: false, reason: 'stripe_unavailable' };

  try {
    const refund = await stripe.refunds.create(
      { payment_intent: order.stripePaymentIntentId, reason: 'requested_by_customer', metadata: { orderId: String(order._id) } },
      { idempotencyKey: `refund_order_${order._id}` }
    );
    order.refundRequestedAt = new Date();
    order.refundError = '';
    applyRefundResult(order, refund);
    await order.save();
    return { refunded: true };
  } catch (error) {
    // L'échec est conservé pour l'administration (relance manuelle possible).
    order.refundError = String(error?.message || 'Remboursement impossible').slice(0, 300);
    await order.save().catch(() => {});
    return { refunded: false, reason: 'error', error: order.refundError };
  }
};

module.exports = { shouldRefund, refundCancelledOrder, reconcileRefunds, applyRefundResult };
