'use strict';

const PromoCode = require('../models/PromoCode');
const Order = require('../models/Order');
const { PROMO_TYPES, normalizeCode, isValidCode, validatePromo, computeDiscount } = require('../utils/promoCodes');

// Vérifie un code pour un client et calcule la remise. Utilisé par le devis et la création de commande.
const resolvePromo = async ({ rawCode, userId, subtotal, deliveryFee, currency, split }) => {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: true, discount: 0, promo: null };
  if (!userId) return { ok: false, code: 'PROMO_LOGIN', message: 'Connecte-toi pour utiliser un code promo.' };
  const promo = await PromoCode.findOne({ code });
  const [userRedemptions, hasPaidOrder] = await Promise.all([
    Order.countDocuments({ user: userId, promoCode: code, status: { $ne: 'Annulée' } }),
    Order.exists({ user: userId, paymentStatus: 'Payé', status: { $ne: 'Annulée' } }),
  ]);
  const check = validatePromo({ promo, subtotal, currency, userRedemptions, isFirstOrder: !hasPaidOrder });
  if (!check.ok) return check;
  const discount = computeDiscount({ promo, subtotal, deliveryFee, split });
  if (discount <= 0) return { ok: false, code: 'PROMO_NO_EFFECT', message: 'Ce code n’apporte aucune remise sur cette commande.' };
  return { ok: true, promo, discount };
};

// Réserve une utilisation (atomique : jamais au-delà du plafond, même en cas de commandes simultanées).
const claimPromoUse = async (promo) => {
  const claimed = await PromoCode.findOneAndUpdate(
    { _id: promo._id, active: true, $or: [{ maxUses: 0 }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
  return Boolean(claimed);
};

const toApi = (p) => ({
  id: String(p._id), code: p.code, description: p.description, type: p.type, value: p.value, currency: p.currency,
  minSubtotal: p.minSubtotal, maxUses: p.maxUses, usedCount: p.usedCount, perUserLimit: p.perUserLimit,
  firstOrderOnly: p.firstOrderOnly, startsAt: p.startsAt, expiresAt: p.expiresAt, active: p.active,
});

// --- Administration -------------------------------------------------------

const parseAdminInput = (body = {}) => {
  const code = normalizeCode(body.code);
  const type = String(body.type || '');
  const value = Number(body.value);
  if (!isValidCode(code)) return { error: 'Code invalide (3 à 24 lettres, chiffres, - ou _).' };
  if (!PROMO_TYPES.includes(type)) return { error: 'Type invalide (percent ou fixed).' };
  if (!Number.isFinite(value) || value <= 0) return { error: 'Valeur invalide.' };
  if (type === 'percent' && value > 100) return { error: 'Un pourcentage ne peut pas dépasser 100.' };
  const currency = String(body.currency || '').toUpperCase().slice(0, 3);
  if (type === 'fixed' && !/^[A-Z]{3}$/.test(currency)) return { error: 'Devise requise pour une remise fixe (CHF ou EUR).' };
  const date = (v) => (v ? new Date(v) : null);
  const startsAt = date(body.startsAt);
  const expiresAt = date(body.expiresAt);
  if ((startsAt && Number.isNaN(+startsAt)) || (expiresAt && Number.isNaN(+expiresAt))) return { error: 'Date invalide.' };
  return {
    value: {
      code, type, value, currency: type === 'fixed' ? currency : '',
      description: String(body.description || '').trim().slice(0, 200),
      minSubtotal: Math.max(0, Number(body.minSubtotal) || 0),
      maxUses: Math.max(0, Math.floor(Number(body.maxUses) || 0)),
      perUserLimit: Math.min(100, Math.max(1, Math.floor(Number(body.perUserLimit) || 1))),
      firstOrderOnly: Boolean(body.firstOrderOnly), startsAt, expiresAt,
    },
  };
};

const listPromos = async (req, res) => {
  const promos = await PromoCode.find().sort({ createdAt: -1 }).limit(200);
  return res.json({ success: true, promoCodes: promos.map(toApi) });
};

const createPromo = async (req, res) => {
  try {
    const parsed = parseAdminInput(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const promo = await PromoCode.create({ ...parsed.value, createdBy: req.user._id });
    return res.status(201).json({ success: true, promoCode: toApi(promo) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Ce code existe déjà.' });
    console.error('Create promo error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const setPromoActive = async (req, res) => {
  const promo = await PromoCode.findByIdAndUpdate(req.params.id, { active: Boolean(req.body?.active) }, { new: true });
  if (!promo) return res.status(404).json({ success: false, message: 'Code introuvable.' });
  return res.json({ success: true, promoCode: toApi(promo) });
};

module.exports = { resolvePromo, claimPromoUse, parseAdminInput, listPromos, createPromo, setPromoActive };
