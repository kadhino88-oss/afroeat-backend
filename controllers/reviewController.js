'use strict';

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const { toRating, publicAuthorName, evaluateReviewEligibility, addToAverage } = require('../utils/reviews');

/** POST /api/orders/:id/review — le client note le commerce (et le livreur) après livraison. */
const createReview = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'ID commande invalide.' });
    }
    const order = await Order.findById(req.params.id).select('user restaurant deliveryPerson status deliveredAt updatedAt selfDelivery');
    const eligibility = evaluateReviewEligibility(order, req.user._id);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({ success: false, code: eligibility.code, message: eligibility.message });
    }

    const restaurantRating = toRating(req.body?.restaurantRating);
    const courierRating = toRating(req.body?.courierRating, { optional: true });
    if (!restaurantRating.ok || !courierRating.ok) {
      return res.status(400).json({ success: false, code: 'INVALID_RATING', message: 'Les notes vont de 1 à 5 étoiles.' });
    }
    const courierId = order.selfDelivery ? null : order.deliveryPerson || null;
    const comment = String(req.body?.comment || '').trim().slice(0, 500);

    let review;
    try {
      review = await Review.create({
        order: order._id,
        user: req.user._id,
        restaurant: order.restaurant,
        courier: courierId,
        restaurantRating: restaurantRating.value,
        courierRating: courierId ? courierRating.value : null,
        comment,
        authorName: publicAuthorName(req.user.name),
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ success: false, code: 'ALREADY_REVIEWED', message: 'Vous avez déjà laissé un avis pour cette commande.' });
      }
      throw error;
    }

    const restaurant = await Restaurant.findById(order.restaurant).select('ratingAverage ratingCount');
    if (restaurant) {
      const next = addToAverage(restaurant.ratingAverage, restaurant.ratingCount, review.restaurantRating);
      await Restaurant.updateOne({ _id: restaurant._id }, { $set: { ratingAverage: next.average, ratingCount: next.count } });
    }
    if (courierId && review.courierRating) {
      const courier = await User.findById(courierId).select('deliveryProfile.ratingAverage deliveryProfile.ratingCount');
      if (courier) {
        const next = addToAverage(courier.deliveryProfile?.ratingAverage, courier.deliveryProfile?.ratingCount, review.courierRating);
        await User.updateOne(
          { _id: courierId },
          { $set: { 'deliveryProfile.ratingAverage': next.average, 'deliveryProfile.ratingCount': next.count } }
        );
      }
    }

    return res.status(201).json({ success: true, review });
  } catch (error) {
    console.error('Review create error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** GET /api/orders/:id/review — l'avis déjà laissé sur cette commande (ou null). */
const getMyOrderReview = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'ID commande invalide.' });
    }
    const review = await Review.findOne({ order: req.params.id, user: req.user._id }).lean();
    return res.json({ success: true, review: review || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** GET /api/restaurants/:id/reviews — avis publics (prénom + initiale uniquement). */
const getRestaurantReviews = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'ID restaurant invalide.' });
    }
    const reviews = await Review.find({ restaurant: req.params.id, hidden: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(30)
      .select('restaurantRating comment authorName createdAt')
      .lean();
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, count: reviews.length, reviews });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** PATCH /api/admin/reviews/:id — masquer ou réafficher un avis abusif. */
const setReviewHidden = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'ID avis invalide.' });
    }
    const review = await Review.findByIdAndUpdate(req.params.id, { $set: { hidden: req.body?.hidden === true } }, { new: true });
    if (!review) return res.status(404).json({ success: false, message: 'Avis introuvable.' });
    return res.json({ success: true, review });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = { createReview, getMyOrderReview, getRestaurantReviews, setReviewHidden };
