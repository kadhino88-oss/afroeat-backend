'use strict';

const isCashPayment = (paymentMethod) =>
  String(paymentMethod ?? '').trim().toLowerCase() === 'cash';

const evaluateDeliveryPayment = ({ nextStatus, paymentStatus, paymentMethod }) => {
  if (nextStatus !== 'Livrée' || paymentStatus === 'Payé') {
    return { allowed: true, cashPaymentCollected: false };
  }

  if (paymentStatus === 'Remboursé') {
    return {
      allowed: false,
      code: 'REFUNDED_ORDER_CANNOT_BE_DELIVERED',
      message: 'Une commande remboursée ne peut pas être finalisée comme livrée.',
      cashPaymentCollected: false,
    };
  }

  if (isCashPayment(paymentMethod)) {
    return { allowed: true, cashPaymentCollected: true };
  }

  return {
    allowed: false,
    code: 'PAYMENT_REQUIRED_BEFORE_DELIVERY',
    message: 'La livraison est bloquée tant que le paiement en ligne n’est pas confirmé.',
    cashPaymentCollected: false,
  };
};

module.exports = { isCashPayment, evaluateDeliveryPayment };
