const mongoose = require('mongoose');

// Demande d'inscription d'un commerce africain (restaurant, épicerie, boutique) sur AFROEAT.
const partnerApplicationSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true, maxlength: 120 },
    businessType: {
      type: String,
      enum: ['restaurant', 'grocery', 'shop', 'drinks', 'other'],
      required: true,
    },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    address: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    country: { type: String, trim: true, maxlength: 80, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    message: { type: String, trim: true, maxlength: 1000, default: '' },
    osmPlaceId: { type: String, trim: true, maxlength: 60, default: '' },
    consent: { type: Boolean, required: true },
    status: {
      type: String,
      enum: ['new', 'contacted', 'approved', 'rejected'],
      default: 'new',
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);

partnerApplicationSchema.index({ email: 1, businessName: 1, createdAt: -1 });

module.exports =
  mongoose.models.PartnerApplication ||
  mongoose.model('PartnerApplication', partnerApplicationSchema);
