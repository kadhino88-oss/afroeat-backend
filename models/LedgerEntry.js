'use strict';

const mongoose = require('mongoose');

/**
 * Ledger comptable minimal des mouvements d'argent (rapprochement avec Stripe).
 *
 * APPEND-ONLY : une écriture n'est jamais modifiée ni supprimée. Une correction se fait par une écriture
 * de signe opposé, jamais par un update. Les hooks ci-dessous refusent toute mise à jour / suppression
 * passant par Mongoose (document, requête ou bulkWrite). Cela ne protège pas contre un accès direct au
 * driver MongoDB : pour un verrou fort, révoquer les droits update/delete sur la collection `ledgerentries`.
 *
 * CONVENTION DE SIGNE de `amountMinor` (entier, unités mineures de `currency`, cf. utils/currency.js :
 * centimes pour EUR, unité entière pour XOF/XAF) :
 *   + = valeur qui ENTRE côté plateforme (encaissement, annulation d'un versement, créance sur un partenaire) ;
 *   - = valeur qui SORT côté plateforme (remboursement, versement, frais, litige perdu, créance soldée).
 *
 *   type               party       signe  signification
 *   charge             customer    +      paiement carte capturé (brut)
 *   stripe_fee         platform    -      frais Stripe sur ce paiement (best-effort)
 *   refund             customer    -      remboursement client (une écriture par remboursement Stripe)
 *   transfer           restaurant/courier  -  transfert Connect vers le partenaire
 *   transfer_reversal  restaurant/courier  +  réversion d'un transfert (remboursement / litige)
 *   dispute_lost       customer    -      montant d'un litige perdu
 *   cash_collected     restaurant/courier  +  espèces encaissées : somme due à la plateforme (créance)
 *   cash_settled       restaurant/courier  -  créance espèces soldée par le partenaire
 */
const LEDGER_TYPES = Object.freeze([
  'charge', 'stripe_fee', 'refund', 'transfer', 'transfer_reversal', 'dispute_lost', 'cash_collected', 'cash_settled',
]);
const LEDGER_PARTIES = Object.freeze(['platform', 'restaurant', 'courier', 'customer']);

const MAX_META_KEYS = 10;
const MAX_META_JSON_LENGTH = 512;

// Devise ISO à 3 lettres majuscules, sans expression régulière.
const isCurrencyCode = (value) => {
  if (typeof value !== 'string' || value.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 65 || code > 90) return false;
  }
  return true;
};

// `meta` : petit objet plat de valeurs primitives (aucune donnée personnelle, jamais de tableau ni d'objet imbriqué).
const isValidMeta = (meta) => {
  if (meta === null || meta === undefined) return true;
  if (typeof meta !== 'object' || Array.isArray(meta)) return false;
  const keys = Object.keys(meta);
  if (keys.length > MAX_META_KEYS) return false;
  for (const key of keys) {
    const value = meta[key];
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) return false;
    if (typeof value === 'number' && !Number.isFinite(value)) return false;
  }
  return JSON.stringify(meta).length <= MAX_META_JSON_LENGTH;
};

const ledgerEntrySchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: LEDGER_TYPES },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      validate: { validator: isCurrencyCode, message: 'Devise invalide' },
    },
    amountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isSafeInteger(value) && value !== 0,
        message: 'amountMinor doit être un entier non nul (unités mineures)',
      },
    },
    party: { type: String, required: true, enum: LEDGER_PARTIES },
    stripeObjectId: { type: String, default: null, trim: true, maxlength: 120 },
    idempotencyKey: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    occurredAt: { type: Date, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null, validate: { validator: isValidMeta, message: 'meta invalide' } },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { versionKey: false, strict: true }
);

// Unicité : rejouer le même événement ne duplique jamais l'écriture.
ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ order: 1 });
ledgerEntrySchema.index({ type: 1, occurredAt: 1 });
ledgerEntrySchema.index({ occurredAt: 1 });

const immutableError = (operation) => {
  const error = new Error(`LedgerEntry est en ajout seul : ${operation} refusé.`);
  error.code = 'LEDGER_IMMUTABLE';
  return error;
};

// Mongoose 9 : les middlewares ne reçoivent plus `next` ; lever une exception suffit à refuser l'opération.
ledgerEntrySchema.pre('save', function refuseSaveOfExistingEntry() {
  if (!this.isNew) throw immutableError('save sur une écriture existante');
});

const blockedQueryOperations = [
  'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace',
  'findOneAndDelete', 'deleteOne', 'deleteMany',
];
for (const operation of blockedQueryOperations) {
  ledgerEntrySchema.pre(operation, { document: false, query: true }, function refuseQueryMutation() {
    throw immutableError(operation);
  });
}
// Variantes appelées depuis un document (doc.updateOne(), doc.deleteOne()).
for (const operation of ['updateOne', 'deleteOne']) {
  ledgerEntrySchema.pre(operation, { document: true, query: false }, function refuseDocumentMutation() {
    throw immutableError(operation);
  });
}
// bulkWrite : seules les insertions sont admises (Mongoose 9 passe les opérations en premier argument).
ledgerEntrySchema.pre('bulkWrite', function refuseBulkMutation(operations) {
  const onlyInserts = Array.isArray(operations) && operations.every((op) => op && typeof op === 'object' && 'insertOne' in op);
  if (!onlyInserts) throw immutableError("bulkWrite autre qu'insertOne");
});

module.exports =
  mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema);
module.exports.LEDGER_TYPES = LEDGER_TYPES;
module.exports.LEDGER_PARTIES = LEDGER_PARTIES;
module.exports.isCurrencyCode = isCurrencyCode;
module.exports.isValidMeta = isValidMeta;
