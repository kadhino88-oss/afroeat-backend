'use strict';

const mongoose = require('mongoose');
const Order = require('../models/Order');

/** Registre des commissions dues par les restaurants pour les commandes encaissées en espèces. */
const listCashLedger = async (req, res) => {
  try {
    const rows = await Order.aggregate([
      { $match: { paymentMethod: 'cash', status: 'Livrée', cashCommissionStatus: { $in: ['due', 'settled'] } } },
      {
        $group: {
          _id: { restaurant: '$restaurant', currency: '$currency', state: '$cashCommissionStatus' },
          orders: { $sum: 1 },
          commission: { $sum: '$platformCommissionAmount' },
        },
      },
      { $lookup: { from: 'restaurants', localField: '_id.restaurant', foreignField: '_id', as: 'r' } },
      {
        $project: {
          _id: 0,
          restaurantId: '$_id.restaurant',
          restaurant: { $arrayElemAt: ['$r.name', 0] },
          currency: '$_id.currency',
          state: '$_id.state',
          orders: 1,
          commission: { $round: ['$commission', 2] },
        },
      },
      { $sort: { state: 1, commission: -1 } },
    ]);
    return res.json({ success: true, ledger: rows });
  } catch (error) {
    console.error('CASH LEDGER ERROR =>', error.message);
    return res.status(500).json({ success: false, message: 'Registre indisponible.' });
  }
};

/** Marque comme réglées les commissions en espèces livrées d'un restaurant. */
const settleCashLedger = async (req, res) => {
  const { restaurantId } = req.params;
  if (!mongoose.isValidObjectId(restaurantId)) {
    return res.status(400).json({ success: false, message: 'Restaurant invalide.' });
  }
  const result = await Order.updateMany(
    { restaurant: restaurantId, paymentMethod: 'cash', status: 'Livrée', cashCommissionStatus: 'due' },
    { $set: { cashCommissionStatus: 'settled', cashCommissionSettledAt: new Date() } }
  );
  return res.json({ success: true, settled: result.modifiedCount || 0 });
};

module.exports = { listCashLedger, settleCashLedger };
