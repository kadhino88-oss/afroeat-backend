'use strict';

const mongoose = require('mongoose');

/**
 * Rapport du rapprochement quotidien ledger / commandes / Stripe (POST /api/payments/ledger/reconcile-daily).
 * Informatif uniquement : il ne corrige rien. Un seul rapport par période (rejouer le même jour le remplace).
 * Aucune donnée personnelle : uniquement des identifiants de commande, des types, devises et montants.
 */
const totalSchema = new mongoose.Schema(
  { type: String, currency: String, count: Number, totalMinor: Number },
  { _id: false }
);

const discrepancySchema = new mongoose.Schema(
  {
    kind: { type: String, required: true },
    orderId: String,
    type: String,
    party: String,
    currency: String,
    stripeObjectId: String,
    count: Number,
    expectedMinor: Number,
    ledgerMinor: Number,
    stripeMinor: Number,
    diffMinor: Number,
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['ok', 'mismatch'], required: true },
    ledgerTotals: { type: [totalSchema], default: [] },
    stripeTotals: { type: [totalSchema], default: [] },
    stripeUnmapped: { type: [totalSchema], default: [] },
    discrepancies: { type: [discrepancySchema], default: [] },
    discrepancyCount: { type: Number, default: 0 },
    truncated: { type: Boolean, default: false },
    stripeComplete: { type: Boolean, default: false },
    stripeTransactions: { type: Number, default: 0 },
    ordersScanned: { type: Number, default: 0 },
    ledgerEntriesScanned: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

reportSchema.index({ periodStart: 1, periodEnd: 1 }, { unique: true });
reportSchema.index({ generatedAt: -1 });

module.exports =
  mongoose.models.LedgerReconciliationReport || mongoose.model('LedgerReconciliationReport', reportSchema);
