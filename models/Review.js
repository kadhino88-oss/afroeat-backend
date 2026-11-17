'use strict';

const mongoose = require('mongoose');

/** Avis d'un client sur une commande livrée : note du commerce et, s'il y en a un, du livreur. */
const reviewSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    courier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    restaurantRating: { type: Number, required: true, min: 1, max: 5 },
    courierRating: { type: Number, default: null, min: 1, max: 5 },
    comment: { type: String, default: '', trim: true, maxlength: 500 },
    authorName: { type: String, default: '', trim: true, maxlength: 60 },
    hidden: { type: Boolean, default: false }, // masqué par l'administration (contenu abusif)
  },
  { timestamps: true }
);

reviewSchema.index({ restaurant: 1, hidden: 1, createdAt: -1 });

module.exports = mongoose.models.Review || mongoose.model('Review', reviewSchema);
