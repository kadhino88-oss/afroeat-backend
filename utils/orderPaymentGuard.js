'use strict';

const getOrderPaymentCreationBlock = (order) => {
  if (!order) {
    return { errorStatus: 404, errorMessage: 'Commande introuvable.' };
  }

  if (order.paymentStatus === 'Payé') {
    return { errorStatus: 409, errorMessage: 'Cette commande a déjà été payée.' };
  }

  if (order.paymentStatus === 'Remboursé') {
    return {
      errorStatus: 409,
      errorMessage: 'Cette commande a été remboursée et ne peut plus être payée.',
    };
  }

  if (order.status === 'Annulée') {
    return { errorStatus: 409, errorMessage: 'Impossible de payer une commande annulée.' };
  }

  return null;
};

module.exports = { getOrderPaymentCreationBlock };
