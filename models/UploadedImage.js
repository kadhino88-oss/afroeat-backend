'use strict';

const mongoose = require('mongoose');

/**
 * Image envoyée par un partenaire (photo de plat, logo).
 * Stockée en base : l'hébergement serverless n'a pas de disque persistant.
 */
const uploadedImageSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contentType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.UploadedImage || mongoose.model('UploadedImage', uploadedImageSchema);
