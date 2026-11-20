'use strict';

const FINAL_ORDER_STATUSES = ['Livrée', 'Annulée'];

/** Compare-and-set filter so competing managers cannot overwrite each other's assignment. */
const buildManualDeliveryAssignmentFilter = (orderId, expectedCourierId = null) => ({
  _id: orderId,
  deliveryPerson: expectedCourierId || null,
  status: { $nin: FINAL_ORDER_STATUSES },
  selfDelivery: { $ne: true },
});

module.exports = {
  FINAL_ORDER_STATUSES,
  buildManualDeliveryAssignmentFilter,
};
