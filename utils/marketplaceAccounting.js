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
const calculateMarketplaceSplit = ({ itemsSubtotal, deliveryFee, rates = null, selfDelivery = false, courierMinimum = 0 } = {}) => {
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
  // Livraison assurée par le restaurant : il garde l'intégralité des frais de livraison.
  const restaurantEarning = roundMoney(subtotal - platformCommissionAmount + (selfDelivery ? fee : 0));
  // Minimum garanti au livreur, pris sur la part plateforme des frais de livraison, jamais au-delà des frais encaissés.
  const minimum = Math.max(0, Number(courierMinimum) || 0);
  const driverEarning = selfDelivery
    ? 0
    : roundMoney(Math.min(fee, Math.max(fee * courierPayoutRateBps / 10000, courierPayoutRateBps > 0 ? minimum : 0)));
  const platformDeliveryEarning = selfDelivery ? 0 : roundMoney(fee - driverEarning);

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
