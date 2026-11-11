'use strict';

const mongoose = require('mongoose');

const CATEGORIES = ['commande', 'paiement', 'livraison', 'compte', 'autre'];
const STATUSES = ['open', 'in_progress', 'resolved'];

const supportTicketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, default: '' },
    category: { type: String, enum: CATEGORIES, default: 'autre' },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: STATUSES, default: 'open', index: true },
    adminResponse: { type: String, default: '', trim: true, maxlength: 2000 },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

supportTicketSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
