const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, minlength: 3, maxlength: 24 },
    description: { type: String, default: '', trim: true, maxlength: 200 },
    type: { type: String, enum: ['percent', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0.01 }, // % (1 à 100) ou montant fixe
    currency: { type: String, default: '', uppercase: true, trim: true, maxlength: 3 }, // requis pour « fixed »
    minSubtotal: { type: Number, default: 0, min: 0 },
    maxUses: { type: Number, default: 0, min: 0 }, // 0 = illimité
    usedCount: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 1, min: 1, max: 100 },
    firstOrderOnly: { type: Boolean, default: false },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PromoCode || mongoose.model('PromoCode', promoCodeSchema);
