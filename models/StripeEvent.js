'use strict';

const mongoose = require('mongoose');

/**
 * Journal des événements webhook Stripe déjà reçus (idempotence).
 * `_id` = identifiant d'événement Stripe : l'unicité est garantie par MongoDB.
 * Purgé automatiquement après 30 jours (Stripe ne rejoue pas au-delà de ~3 jours).
 */
const stripeEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    type: { type: String, required: true, trim: true },
    status: { type: String, enum: ['processing', 'done'], default: 'processing' },
    lockedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  },
  { versionKey: false }
);

module.exports = mongoose.models.StripeEvent || mongoose.model('StripeEvent', stripeEventSchema);
