'use strict';

const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const { CATEGORIES, STATUSES } = SupportTicket;

const MAX_OPEN_TICKETS_PER_USER = 20;
const text = (value) => String(value ?? '').trim();
const limitOf = (value, fallback) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), 200);

const publicTicket = (ticket) => ({
  _id: ticket._id,
  category: ticket.category,
  subject: ticket.subject,
  message: ticket.message,
  status: ticket.status,
  adminResponse: ticket.adminResponse || '',
  respondedAt: ticket.respondedAt || null,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
});

/** POST /api/support/tickets — { category, subject, message } (tout compte connecté). */
const createTicket = async (req, res) => {
  try {
    const category = CATEGORIES.includes(text(req.body?.category)) ? text(req.body.category) : 'autre';
    const subject = text(req.body?.subject);
    const message = text(req.body?.message);

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Le sujet et le message sont obligatoires.' });
    }
    if (subject.length > 120 || message.length > 2000) {
      return res.status(422).json({ success: false, message: 'Sujet ou message trop long.' });
    }
    if (message.length < 20) {
      return res.status(422).json({ success: false, message: 'Décris ton problème en au moins 20 caractères.' });
    }

    const open = await SupportTicket.countDocuments({ user: req.user._id, status: { $ne: 'resolved' } });
    if (open >= MAX_OPEN_TICKETS_PER_USER) {
      return res.status(429).json({ success: false, message: 'Trop de demandes en cours. Attends une réponse.' });
    }

    const ticket = await SupportTicket.create({
      user: req.user._id,
      role: text(req.user.role),
      category,
      subject,
      message,
    });
    return res.status(201).json({ success: true, ticket: publicTicket(ticket) });
  } catch (error) {
    console.error('Create support ticket error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** GET /api/support/tickets/mine */
const listMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limitOf(req.query?.limit, 50))
      .lean();
    return res.json({ success: true, tickets: tickets.map(publicTicket) });
  } catch (error) {
    console.error('List my support tickets error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** GET /api/support/tickets — admin : toutes les demandes, avec leur auteur. */
const listAllTickets = async (req, res) => {
  try {
    const filter = STATUSES.includes(text(req.query?.status)) ? { status: text(req.query.status) } : {};
    const tickets = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitOf(req.query?.limit, 100))
      .populate('user', 'name email role phone')
      .lean();
    return res.json({
      success: true,
      tickets: tickets.map((t) => ({ ...publicTicket(t), role: t.role, user: t.user || null })),
    });
  } catch (error) {
    console.error('List support tickets error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** PATCH /api/support/tickets/:id — admin : { status, adminResponse }. */
const updateTicket = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }
    const update = {};
    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(text(req.body.status))) {
        return res.status(422).json({ success: false, message: 'Statut invalide.' });
      }
      update.status = text(req.body.status);
    }
    const response = text(req.body?.adminResponse);
    if (response) {
      if (response.length > 2000) {
        return res.status(422).json({ success: false, message: 'Réponse trop longue.' });
      }
      update.adminResponse = response;
      update.respondedAt = new Date();
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'Rien à modifier.' });
    }
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!ticket) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    return res.json({ success: true, ticket: publicTicket(ticket) });
  } catch (error) {
    console.error('Update support ticket error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = { createTicket, listMyTickets, listAllTickets, updateTicket };
