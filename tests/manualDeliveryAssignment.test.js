'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  FINAL_ORDER_STATUSES,
  buildManualDeliveryAssignmentFilter,
} = require('../utils/manualDeliveryAssignment');

test('manual assignment claims only the courier currently stored on the order', () => {
  const orderId = new mongoose.Types.ObjectId();
  const courierId = new mongoose.Types.ObjectId();

  assert.deepEqual(buildManualDeliveryAssignmentFilter(orderId), {
    _id: orderId,
    deliveryPerson: null,
    status: { $nin: FINAL_ORDER_STATUSES },
    selfDelivery: { $ne: true },
  });

  assert.deepEqual(buildManualDeliveryAssignmentFilter(orderId, courierId), {
    _id: orderId,
    deliveryPerson: courierId,
    status: { $nin: FINAL_ORDER_STATUSES },
    selfDelivery: { $ne: true },
  });
});

test('manual assignment filter excludes delivered, cancelled and self-delivery orders', () => {
  const filter = buildManualDeliveryAssignmentFilter('order-id');
  assert.deepEqual(filter.status.$nin, ['Livrée', 'Annulée']);
  assert.deepEqual(filter.selfDelivery, { $ne: true });
});
