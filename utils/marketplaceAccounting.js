'use strict';

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const validateRate = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new RangeError(`${name} doit être un entier entre 0 et 10000 points de base.`);
  }
};

/**
 * Divide food-subtotal and delivery-fee revenue according to configured,
 * validated basis-point rates. This only records the ledger split; it does not
 * initiate Stripe transfers.
 */
const calculateMarketplaceSplit = ({ itemsSubtotal, deliveryFee, rates = null } = {}) => {
  const subtotal = Number(itemsSubtotal);
  const fee = Number(deliveryFee);

  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new RangeError('Le sous-total de commande est invalide.');
  }
  if (!Number.isFinite(fee) || fee < 0) {
    throw new RangeError('Les frais de livraison sont invalides.');
  }

  const commissionRateBps = rates?.commissionBps ?? 0;
  const courierPayoutRateBps = rates?.courierPayoutBps ?? 0;
  validateRate(commissionRateBps, 'commissionBps');
  validateRate(courierPayoutRateBps, 'courierPayoutBps');

  const platformCommissionAmount = roundMoney(subtotal * commissionRateBps / 10000);
  const restaurantEarning = roundMoney(subtotal - platformCommissionAmount);
  const driverEarning = roundMoney(fee * courierPayoutRateBps / 10000);
  const platformDeliveryEarning = roundMoney(fee - driverEarning);

  return {
    commissionRateBps,
    courierPayoutRateBps,
    platformCommissionAmount,
    restaurantEarning,
    driverEarning,
    platformDeliveryEarning,
  };
};

module.exports = { calculateMarketplaceSplit };
