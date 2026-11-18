'use strict';

const { isRealProduction } = require('./runtimeEnvironment');

/**
 * Paiement en espèces.
 * En vraie production, il n'est proposé que lorsque le restaurant encaisse lui-même :
 * livraison assurée par le restaurant ou retrait sur place. Aucun livreur AFROEAT n'est alors
 * à payer, et la commission de la plateforme est inscrite au registre « à régler » du restaurant.
 */
const isCashEligibleOrder = (order) =>
  Boolean(order) && (order.selfDelivery === true || order.fulfillment === 'pickup');

const isCashAllowedForOrder = (order, env = process.env) =>
  !isRealProduction(env) || isCashEligibleOrder(order);

module.exports = { isCashEligibleOrder, isCashAllowedForOrder };
