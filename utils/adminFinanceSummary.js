'use strict';

const { CAPTURED_PAYMENT_STATUS_VALUES } = require('./revenueRecognition');

/** Finance figures use stored payment and marketplace split values; no rate is inferred here. */
const buildAdminFinancePipeline = () => [
  {
    $match: {
      paymentStatus: { $in: CAPTURED_PAYMENT_STATUS_VALUES },
    },
  },
  {
    $group: {
      _id: { $toUpper: { $ifNull: ['$currency', 'EUR'] } },
      capturedOrders: { $sum: 1 },
      grossCollected: { $sum: { $ifNull: ['$totalPrice', 0] } },
      platformCommission: {
        $sum: {
          $cond: [
            { $eq: ['$marketplaceSplitCalculated', true] },
            { $ifNull: ['$platformCommissionAmount', 0] },
            0,
          ],
        },
      },
      merchantShare: {
        $sum: {
          $cond: [
            { $eq: ['$marketplaceSplitCalculated', true] },
            { $ifNull: ['$restaurantEarning', 0] },
            0,
          ],
        },
      },
      courierShare: {
        $sum: {
          $cond: [
            { $eq: ['$marketplaceSplitCalculated', true] },
            { $ifNull: ['$driverEarning', 0] },
            0,
          ],
        },
      },
      ordersNeedingReconciliation: {
        $sum: {
          $cond: [{ $eq: ['$marketplaceSplitCalculated', true] }, 0, 1],
        },
      },
    },
  },
  {
    $project: {
      _id: 0,
      currency: '$_id',
      capturedOrders: 1,
      grossCollected: { $round: ['$grossCollected', 2] },
      platformCommission: { $round: ['$platformCommission', 2] },
      merchantShare: { $round: ['$merchantShare', 2] },
      courierShare: { $round: ['$courierShare', 2] },
      ordersNeedingReconciliation: 1,
    },
  },
  { $sort: { currency: 1 } },
];

module.exports = { buildAdminFinancePipeline };
