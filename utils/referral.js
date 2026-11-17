'use strict';

const crypto = require('crypto');

/**
 * Parrainage sans coût pour la plateforme : la remise est un code promo, donc plafonnée
 * à 80 % de la marge AFROEAT sur la commande (jamais de perte).
 * - L'ami parrainé : -15 % sur sa première commande avec le code du parrain.
 * - Le parrain : un code personnel de -15 % dès que la commande de son ami est livrée.
 */
const REFERRAL_PERCENT = 15;
const REWARD_PERCENT = 15;
const REWARD_VALID_DAYS = 90;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomSuffix = (length = 4) =>
  Array.from(crypto.randomBytes(length), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** AWA-7K2F : prénom (sans accents, 6 lettres max) + suffixe aléatoire. */
const buildReferralCode = (name, suffix = randomSuffix()) => {
  const base = String(name || '')
    .trim()
    .split(/\s+/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6);
  return `${base || 'AMI'}-${suffix}`;
};

const getOrCreateReferralCode = async (user, PromoCode) => {
  const existing = await PromoCode.findOne({ kind: 'referral', owner: user._id });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await PromoCode.create({
        code: buildReferralCode(user.name),
        kind: 'referral',
        owner: user._id,
        description: 'Code de parrainage',
        type: 'percent',
        value: REFERRAL_PERCENT,
        firstOrderOnly: true,
        perUserLimit: 1,
        maxUses: 0,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error; // code déjà pris : nouvel essai
    }
  }
  throw new Error('Impossible de créer le code de parrainage.');
};

/** Commande livrée avec le code d'un parrain : le parrain reçoit sa récompense (une fois par commande). */
const rewardReferrerForOrder = async (order, PromoCode) => {
  if (!order?.promoCode) return null;
  const referral = await PromoCode.findOne({ code: order.promoCode, kind: 'referral' });
  if (!referral?.owner || String(referral.owner) === String(order.user)) return null;
  const already = await PromoCode.findOne({ kind: 'referral_reward', sourceOrder: order._id });
  if (already) return already;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await PromoCode.create({
        code: `MERCI-${randomSuffix(6)}`,
        kind: 'referral_reward',
        restrictedTo: referral.owner,
        sourceOrder: order._id,
        description: 'Merci pour votre parrainage',
        type: 'percent',
        value: REWARD_PERCENT,
        maxUses: 1,
        perUserLimit: 1,
        expiresAt: new Date(Date.now() + REWARD_VALID_DAYS * 86400000),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return null;
};

module.exports = {
  REFERRAL_PERCENT,
  REWARD_PERCENT,
  REWARD_VALID_DAYS,
  buildReferralCode,
  getOrCreateReferralCode,
  rewardReferrerForOrder,
};
