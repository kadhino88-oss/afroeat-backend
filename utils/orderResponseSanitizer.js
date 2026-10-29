'use strict';

const PROVIDER_AND_PAYOUT_FIELDS = [
  'stripePaymentIntentId',
  'stripeCheckoutSessionId',
  'stripeRefundId',
  'stripeAmountRefunded',
  'stripeRestaurantTransferId',
  'stripeCourierTransferId',
  'stripeRestaurantReversalId',
  'stripeCourierReversalId',
  'stripeDisputeId',
  'stripeDisputeClosedAt',
  'payoutStatus',
  'payoutError',
  'payoutUpdatedAt',
  'payoutResolvedAt',
  'payoutResolvedBy',
  'payoutResolutionNote',
  'marketplaceSplitCalculated',
];

const ALL_SPLIT_FIELDS = [
  'platformCommissionAmount',
  'restaurantEarning',
  'driverEarning',
  'platformDeliveryEarning',
  'commissionRateBps',
  'courierPayoutRateBps',
];

const sanitizeOrderForViewer = (source, viewerRole) => {
  const order = source && typeof source === 'object' ? { ...source } : {};
  const role = String(viewerRole || '').trim().toLowerCase();

  // Only admins can inspect payment-provider identifiers, dispute details,
  // payout reconciliation notes, or Connect transfer/reversal identifiers.
  if (role !== 'admin') {
    for (const field of PROVIDER_AND_PAYOUT_FIELDS) delete order[field];
  }

  if (role === 'admin') return order;

  if (role === 'restaurant') {
    for (const field of ['driverEarning', 'platformDeliveryEarning', 'courierPayoutRateBps']) {
      delete order[field];
    }
  } else if (role === 'livreur') {
    for (const field of ['platformCommissionAmount', 'restaurantEarning', 'platformDeliveryEarning', 'commissionRateBps', 'courierPayoutRateBps']) {
      delete order[field];
    }
  } else {
    // Clients and unknown roles must not receive internal marketplace splits.
    for (const field of ALL_SPLIT_FIELDS) delete order[field];
  }

  return order;
};

module.exports = { sanitizeOrderForViewer };
