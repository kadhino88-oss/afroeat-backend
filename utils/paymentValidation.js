'use strict';

const idOf = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value._id !== null && value._id !== undefined) {
    return String(value._id);
  }
  return String(value);
};

const expectedPaymentDetails = (order, toStripeAmount) => {
  const currency = String(order?.currency || 'EUR').trim().toUpperCase();
  const amountValue = Number(Number(order?.totalPrice || 0).toFixed(2));
  const amount = typeof toStripeAmount === 'function'
    ? toStripeAmount(amountValue, currency)
    : null;

  return {
    orderId: idOf(order?._id),
    userId: idOf(order?.user),
    currency: currency.toLowerCase(),
    amount,
  };
};

const isMatchingPaymentIntent = ({ order, paymentIntent, toStripeAmount }) => {
  if (!order || !paymentIntent || typeof toStripeAmount !== 'function') return false;

  const expected = expectedPaymentDetails(order, toStripeAmount);
  return Boolean(
    expected.orderId &&
      expected.userId &&
      Number.isSafeInteger(expected.amount) &&
      expected.amount > 0 &&
      paymentIntent.status === 'succeeded' &&
      paymentIntent.id &&
      paymentIntent.id === order.stripePaymentIntentId &&
      paymentIntent.metadata?.orderId === expected.orderId &&
      paymentIntent.metadata?.userId === expected.userId &&
      paymentIntent.amount === expected.amount &&
      String(paymentIntent.currency || '').toLowerCase() === expected.currency
  );
};

const isMatchingCheckoutSession = ({ order, checkoutSession, toStripeAmount }) => {
  if (!order || !checkoutSession || typeof toStripeAmount !== 'function') return false;

  const expected = expectedPaymentDetails(order, toStripeAmount);
  const sessionOrderId =
    checkoutSession.metadata?.orderId || checkoutSession.client_reference_id;

  return Boolean(
    expected.orderId &&
      expected.userId &&
      Number.isSafeInteger(expected.amount) &&
      expected.amount > 0 &&
      checkoutSession.mode === 'payment' &&
      checkoutSession.payment_status === 'paid' &&
      checkoutSession.id &&
      checkoutSession.id === order.stripeCheckoutSessionId &&
      sessionOrderId === expected.orderId &&
      checkoutSession.metadata?.userId === expected.userId &&
      checkoutSession.amount_total === expected.amount &&
      String(checkoutSession.currency || '').toLowerCase() === expected.currency
  );
};

module.exports = {
  expectedPaymentDetails,
  isMatchingPaymentIntent,
  isMatchingCheckoutSession,
};
