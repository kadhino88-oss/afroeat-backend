'use strict';

const mongoose = require('mongoose');
const Order = require('../models/Order');

const delivered = { paymentMethod: 'cash', status: 'Livrée' };
const restaurantHolds = { $or: [{ selfDelivery: true }, { fulfillment: 'pickup' }] };
const courierHolds = { selfDelivery: { $ne: true }, fulfillment: { $ne: 'pickup' } };

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Registre des espèces :
 * - dueFromRestaurants : commission due par les restaurants qui ont encaissé (livraison par eux ou retrait) ;
 * - dueFromCouriers : somme encaissée par un livreur moins sa part et son pourboire, à reverser à la plateforme ;
 * - owedToRestaurants : part des restaurants que la plateforme doit régler quand un livreur a encaissé.
 */
const listCashLedger = async (req, res) => {
  try {
    const [restaurants, couriers, owed] = await Promise.all([
      Order.aggregate([
        { $match: { ...delivered, ...restaurantHolds, cashCommissionStatus: 'due' } },
        { $group: { _id: { id: '$restaurant', currency: '$currency' }, orders: { $sum: 1 }, amount: { $sum: '$platformCommissionAmount' } } },
        { $lookup: { from: 'restaurants', localField: '_id.id', foreignField: '_id', as: 'who' } },
        { $project: { _id: 0, id: '$_id.id', name: { $arrayElemAt: ['$who.name', 0] }, currency: '$_id.currency', orders: 1, amount: 1 } },
      ]),
      Order.aggregate([
        { $match: { ...delivered, ...courierHolds, cashCommissionStatus: 'due', deliveryPerson: { $ne: null } } },
        {
          $group: {
            _id: { id: '$deliveryPerson', currency: '$currency' },
            orders: { $sum: 1 },
            amount: { $sum: { $max: [0, { $subtract: [{ $subtract: ['$totalPrice', '$driverEarning'] }, '$tipAmount'] }] } },
          },
        },
        { $lookup: { from: 'users', localField: '_id.id', foreignField: '_id', as: 'who' } },
        { $project: { _id: 0, id: '$_id.id', name: { $arrayElemAt: ['$who.name', 0] }, currency: '$_id.currency', orders: 1, amount: 1 } },
      ]),
      Order.aggregate([
        { $match: { ...delivered, ...courierHolds, deliveryPerson: { $ne: null }, cashRestaurantPaidAt: null } },
        { $group: { _id: { id: '$restaurant', currency: '$currency' }, orders: { $sum: 1 }, amount: { $sum: '$restaurantEarning' } } },
        { $lookup: { from: 'restaurants', localField: '_id.id', foreignField: '_id', as: 'who' } },
        { $project: { _id: 0, id: '$_id.id', name: { $arrayElemAt: ['$who.name', 0] }, currency: '$_id.currency', orders: 1, amount: 1 } },
      ]),
    ]);
    const clean = (rows) => rows.map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount);
    return res.json({
      success: true,
      dueFromRestaurants: clean(restaurants),
      dueFromCouriers: clean(couriers),
      owedToRestaurants: clean(owed),
    });
  } catch (error) {
    console.error('CASH LEDGER ERROR =>', error.message);
    return res.status(500).json({ success: false, message: 'Registre indisponible.' });
  }
};

const settleCashLedger = async (req, res) => {
  const { kind, id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Identifiant invalide.' });
  const now = new Date();
  let result;
  if (kind === 'restaurant') {
    result = await Order.updateMany(
      { ...delivered, ...restaurantHolds, restaurant: id, cashCommissionStatus: 'due' },
      { $set: { cashCommissionStatus: 'settled', cashCommissionSettledAt: now } }
    );
  } else if (kind === 'courier') {
    result = await Order.updateMany(
      { ...delivered, ...courierHolds, deliveryPerson: id, cashCommissionStatus: 'due' },
      { $set: { cashCommissionStatus: 'settled', cashCommissionSettledAt: now } }
    );
  } else if (kind === 'restaurant-payout') {
    result = await Order.updateMany(
      { ...delivered, ...courierHolds, restaurant: id, deliveryPerson: { $ne: null }, cashRestaurantPaidAt: null },
      { $set: { cashRestaurantPaidAt: now } }
    );
  } else {
    return res.status(400).json({ success: false, message: 'Type de règlement inconnu.' });
  }
  return res.json({ success: true, settled: result.modifiedCount || 0 });
};

module.exports = { listCashLedger, settleCashLedger };
