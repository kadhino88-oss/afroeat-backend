const mongoose = require('mongoose');

// Lieux publics importés d'OpenStreetMap (restaurants, fast-foods, épiceries).
const placeSchema = new mongoose.Schema(
  {
    osmKey: { type: String, required: true, unique: true }, // ex. node/123456
    kind: { type: String, enum: ['restaurant', 'fast_food', 'grocery'], required: true, index: true },
    name: { type: String, required: true, trim: true },
    cuisine: { type: String, default: '' },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    openingHours: { type: String, default: '' },
    isAfrican: { type: Boolean, default: false, index: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    region: { type: String, default: '', index: true },
    importedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

placeSchema.index({ location: '2dsphere' });

module.exports = mongoose.models.Place || mongoose.model('Place', placeSchema);
