'use strict';

const mongoose = require('mongoose');

/** Message échangé pendant une commande entre le client, le livreur et le commerce. */
const orderMessageSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['client', 'livreur', 'restaurant', 'admin'], required: true },
    senderName: { type: String, default: '', trim: true, maxlength: 60 },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  },
  { timestamps: true }
);

orderMessageSchema.index({ order: 1, createdAt: 1 });

module.exports = mongoose.models.OrderMessage || mongoose.model('OrderMessage', orderMessageSchema);
