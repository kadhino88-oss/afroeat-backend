const mongoose = require('mongoose');

// Erreurs regroupées par empreinte : une ligne par problème, avec un compteur d'occurrences.
const errorEventSchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, unique: true },
    source: { type: String, enum: ['api', 'web'], required: true },
    message: { type: String, default: '' },
    stack: { type: String, default: '' },
    method: { type: String, default: '' },
    path: { type: String, default: '' },
    status: { type: Number, default: 0 },
    lastRequestId: { type: String, default: '' },
    lastUserRole: { type: String, default: '' },
    lastUserAgent: { type: String, default: '' },
    count: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

module.exports = mongoose.models.ErrorEvent || mongoose.model('ErrorEvent', errorEventSchema);
