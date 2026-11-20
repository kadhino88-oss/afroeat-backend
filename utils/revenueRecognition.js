'use strict';

const normalizePaymentStatus = (value) =>
  String(value ?? '').trim().toLowerCase();

const CAPTURED_PAYMENT_STATUSES = new Set(['paid', 'payé', 'paye']);
const CAPTURED_PAYMENT_STATUS_VALUES = [
  'Payé', 'payé', 'PAYÉ', 'Paye', 'paye', 'PAYE', 'paid', 'Paid', 'PAID',
];
const REFUNDED_PAYMENT_STATUSES = new Set(['refunded', 'remboursé', 'rembourse']);

/** Only count money the payment system has confirmed as captured and not refunded. */
const isRevenueRecognizedOrder = (order) => {
  const paymentStatus = normalizePaymentStatus(order?.paymentStatus);
  return (
    CAPTURED_PAYMENT_STATUSES.has(paymentStatus) &&
    !REFUNDED_PAYMENT_STATUSES.has(paymentStatus)
  );
};

module.exports = {
  CAPTURED_PAYMENT_STATUS_VALUES,
  isRevenueRecognizedOrder,
};
