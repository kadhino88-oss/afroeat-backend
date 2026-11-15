'use strict';

const mongoose = require('mongoose');

/**
 * Fichier chiffré d'une pièce justificative. Jamais renvoyé par une route publique.
 * L'index TTL sur expiresAt le fait supprimer automatiquement par MongoDB à l'échéance.
 */
const verificationFileSchema = new mongoose.Schema(
  {
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'VerificationDocument', required: true, unique: true },
    iv: { type: Buffer, required: true },
    tag: { type: Buffer, required: true },
    data: { type: Buffer, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

verificationFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('VerificationFile', verificationFileSchema);
