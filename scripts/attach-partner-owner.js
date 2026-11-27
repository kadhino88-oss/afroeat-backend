'use strict';

/**
 * Rattache une fiche restaurant EXISTANTE (copiée depuis l'ancienne base) à un compte propriétaire, et peut corriger
 * son pays et sa devise. Ne crée jamais de second restaurant, ne touche ni au menu ni à la visibilité.
 *
 *   MONGO_URI=... RESTAURANT_ID=... OWNER_EMAIL=... OWNER_NAME=... [OWNER_PHONE=...] [COUNTRY=France|Suisse] \
 *   [APPLY=true] node scripts/attach-partner-owner.js
 *
 * - Simulation par défaut : affiche ce qui serait fait, n'écrit rien.
 * - Le compte propriétaire reçoit un mot de passe aléatoire jamais affiché ni conservé : le restaurateur choisit
 *   le sien avec « Mot de passe oublié » (envoi d'e-mails requis).
 * - Refuse si la fiche a déjà un propriétaire qui existe, ou si l'e-mail appartient à un compte d'un autre rôle.
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { isValidEmailAddress } = require('../utils/emailValidation');
const { normalizeCountry, currencyFor } = require('../utils/partnerRestaurant');
const { connectOfficialDatabase } = require('../utils/officialDatabase');

const COUNTRIES = ['France', 'Suisse'];

/** Décision pure (testée) : que faut-il faire, ou pourquoi refuser. */
const planAttach = ({ restaurant, currentOwnerExists, existingAccount, country }) => {
  if (!restaurant) return { ok: false, reason: 'Restaurant introuvable.' };
  if (currentOwnerExists) return { ok: false, reason: 'Cette fiche a déjà un propriétaire existant : rien n\'est modifié.' };
  if (existingAccount && existingAccount.role !== 'restaurant') {
    return { ok: false, reason: `Un compte « ${existingAccount.role} » existe déjà avec cet e-mail : rien n'est modifié.` };
  }
  const regional = country ? { country: normalizeCountry(country), currency: currencyFor(country) } : null;
  if (regional && !COUNTRIES.includes(regional.country)) return { ok: false, reason: 'Pays accepté : France ou Suisse.' };
  return { ok: true, createAccount: !existingAccount, regional };
};

const main = async () => {
  const { MONGO_URI, RESTAURANT_ID, OWNER_EMAIL, OWNER_NAME, OWNER_PHONE, COUNTRY } = process.env;
  const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
  const email = String(OWNER_EMAIL || '').trim().toLowerCase();
  if (!MONGO_URI || !mongoose.isValidObjectId(RESTAURANT_ID)) throw new Error('MONGO_URI et RESTAURANT_ID valides requis.');
  if (!isValidEmailAddress(email)) throw new Error('OWNER_EMAIL invalide.');
  if (String(OWNER_NAME || '').trim().length < 2) throw new Error('OWNER_NAME requis.');

  await connectOfficialDatabase(mongoose, MONGO_URI);
  const User = require('../models/User');
  const Restaurant = require('../models/Restaurant');

  const restaurant = await Restaurant.findById(RESTAURANT_ID).select('_id owner country currency');
  const currentOwnerExists = restaurant && restaurant.owner ? Boolean(await User.exists({ _id: restaurant.owner })) : false;
  const existingAccount = await User.findOne({ email }).select('_id role');
  const plan = planAttach({ restaurant, currentOwnerExists, existingAccount, country: String(COUNTRY || '').trim() });
  if (!plan.ok) throw new Error(plan.reason);

  console.log(apply ? 'Mode APPLY.' : 'Mode simulation : rien n\'est écrit (APPLY=true pour écrire).');
  console.log(`Compte propriétaire : ${plan.createAccount ? 'à créer (mot de passe aléatoire)' : 'déjà existant, réutilisé'}`);
  console.log(`Fiche : propriétaire actuel absent de la base -> rattachée au compte${plan.regional ? `, pays ${plan.regional.country}, devise ${plan.regional.currency}` : ''}`);
  if (!apply) return;

  let owner = existingAccount;
  if (plan.createAccount) {
    owner = await User.create({
      name: String(OWNER_NAME).trim(), email, role: 'restaurant', phone: String(OWNER_PHONE || '').trim(),
      password: `${crypto.randomBytes(24).toString('hex')}aA1!`, // jamais affiché ni conservé
      country: plan.regional ? plan.regional.country : restaurant.country || '', accountStatus: 'active',
    });
  }
  await Restaurant.updateOne({ _id: restaurant._id }, { $set: { owner: owner._id, ...(plan.regional || {}) } });
  console.log('Terminé. Le restaurateur choisit son mot de passe avec « Mot de passe oublié ».');
};

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (error) => {
      console.error(`Échec : ${error.message}`);
      try { await mongoose.disconnect(); } catch { /* ignore */ }
      process.exit(1);
    });
}

module.exports = { planAttach };
