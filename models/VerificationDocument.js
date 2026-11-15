'use strict';

const mongoose = require('mongoose');
const { ALL_KINDS } = require('../utils/verificationRules');

/**
 * Pièce justificative d'un partenaire : uniquement les informations de suivi.
 * Le fichier chiffré est dans VerificationFile et s'efface tout seul à l'échéance.
 */
const verificationDocumentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ALL_KINDS, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    // Le partenaire a accepté le traitement de sa pièce au moment de l'envoi.
    consentAt: { type: Date, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '', trim: true, maxlength: 500 },
    // Date à laquelle le fichier est (ou a été) effacé.
    fileExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

verificationDocumentSchema.index({ user: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model('VerificationDocument', verificationDocumentSchema);
