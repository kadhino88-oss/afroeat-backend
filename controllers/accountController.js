'use strict';

const crypto = require('crypto');
const User = require('../models/User');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const SupportTicket = require('../models/SupportTicket');
const VerificationDocument = require('../models/VerificationDocument');
const VerificationFile = require('../models/VerificationFile');
const { parseAddressInput, addAddress, removeAddress } = require('../utils/savedAddresses');
const {
  ACTIVE_ORDER_STATUSES,
  canDeleteRole,
  buildAnonymizedFields,
  accountDeletionPageHtml,
} = require('../utils/accountLifecycle');

// DELETE /api/users/me/account — { password, confirmation: true }
const deleteMyAccount = async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!password || req.body?.confirmation !== true) {
      return res.status(400).json({ success: false, message: 'Mot de passe et confirmation obligatoires.' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    if (!canDeleteRole(user.role)) {
      return res.status(403).json({ success: false, message: 'Ce type de compte ne peut pas être supprimé ici.' });
    }
    if (!(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, code: 'PASSWORD_INCORRECT', message: 'Mot de passe incorrect.' });
    }

    const restaurants = user.role === 'restaurant' ? await Restaurant.find({ owner: user._id }).select('_id') : [];
    const activeFilter = { status: { $in: ACTIVE_ORDER_STATUSES } };
    const busy = await Order.exists({
      ...activeFilter,
      $or: [
        { user: user._id },
        { deliveryPerson: user._id },
        ...(restaurants.length ? [{ restaurant: { $in: restaurants.map((r) => r._id) } }] : []),
      ],
    });
    if (busy) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_HAS_ACTIVE_ORDERS',
        message: 'Une commande est en cours. Terminez-la ou annulez-la avant de supprimer le compte.',
      });
    }

    // Pièces justificatives : suppression immédiate.
    const docs = await VerificationDocument.find({ user: user._id }).select('_id');
    if (docs.length) {
      await VerificationFile.deleteMany({ document: { $in: docs.map((d) => d._id) } });
      await VerificationDocument.deleteMany({ user: user._id });
    }

    // Commerces du restaurateur : retirés du catalogue public.
    if (restaurants.length) {
      await Restaurant.updateMany({ owner: user._id }, { $set: { isActive: false, isOpen: false } });
    }

    // Cartes enregistrées : suppression du client Stripe (au mieux).
    if (user.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.customers.del(user.stripeCustomerId);
      } catch (error) {
        console.error('Suppression client Stripe impossible :', error.message);
      }
    }

    Object.assign(user, buildAnonymizedFields(user._id, crypto.randomBytes(32).toString('hex') + 'aA1!'));
    user.stripeCustomerId = '';
    user.stripeConnectAccountId = '';
    user.favoriteRestaurants = [];
    await user.save({ validateBeforeSave: false });

    return res.json({ success: true, message: 'Compte supprimé.' });
  } catch (error) {
    console.error('Delete account error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// GET /api/users/me/export — copie des données personnelles (droit d'accès / portabilité).
const exportMyData = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    const [orders, tickets] = await Promise.all([
      Order.find({ user: user._id }).sort({ createdAt: -1 }).limit(1000).lean(),
      SupportTicket.find({ user: user._id }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);

    // Copie sans aucun secret : mot de passe, jetons de réinitialisation, secrets de double authentification.
    const { password, passwordResetTokenHash, passwordResetExpires, pushToken, twoFactor, ...profile } = user;
    if (twoFactor) profile.twoFactorEnabled = Boolean(twoFactor.enabled);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', 'attachment; filename="afroeat-mes-donnees.json"');
    return res.json({ exportedAt: new Date().toISOString(), profile, orders, supportTickets: tickets });
  } catch (error) {
    console.error('Export data error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// GET /api/users/account-deletion — page publique (exigée par les boutiques d'applications).
const accountDeletionPage = (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  return res.send(accountDeletionPageHtml(process.env.SUPPORT_EMAIL || process.env.PARTNER_NOTIFY_EMAIL));
};

const toApi = (list) => (list || []).map((a) => ({ id: String(a._id), label: a.label || '', address: a.address, isDefault: Boolean(a.isDefault) }));

// GET /api/users/me/addresses
const listAddresses = async (req, res) => {
  const user = await User.findById(req.user.id).select('savedAddresses');
  return res.json({ success: true, addresses: toApi(user?.savedAddresses) });
};

// POST /api/users/me/addresses — { label?, address, isDefault? }
const createAddress = async (req, res) => {
  try {
    const parsed = parseAddressInput(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const user = await User.findById(req.user.id).select('savedAddresses address');
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    const result = addAddress(user.savedAddresses, parsed.value);
    if (result.error) return res.status(409).json({ success: false, code: 'ADDRESS_LIMIT', message: result.error });
    user.savedAddresses = result.list;
    const def = result.list.find((a) => a.isDefault);
    if (def) user.address = def.address; // l'adresse par défaut alimente aussi le profil
    await user.save({ validateBeforeSave: false });
    return res.status(201).json({ success: true, addresses: toApi(user.savedAddresses) });
  } catch (error) {
    console.error('Create address error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// DELETE /api/users/me/addresses/:id
const deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('savedAddresses address');
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    user.savedAddresses = removeAddress(user.savedAddresses, req.params.id);
    const def = user.savedAddresses.find((a) => a.isDefault);
    if (def) user.address = def.address;
    await user.save({ validateBeforeSave: false });
    return res.json({ success: true, addresses: toApi(user.savedAddresses) });
  } catch (error) {
    console.error('Delete address error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

module.exports = { deleteMyAccount, exportMyData, accountDeletionPage, listAddresses, createAddress, deleteAddress };
