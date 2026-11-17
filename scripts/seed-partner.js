'use strict';

/**
 * Crée (ou met à jour) un commerce partenaire et son menu à partir de data/partners/<clé>.json.
 * La fiche est créée MASQUÉE (isActive=false) : l'administrateur vérifie les prix avec le partenaire,
 * puis l'active depuis l'administration. Le compte propriétaire reçoit un mot de passe aléatoire jamais
 * affiché : le partenaire le remplace via « Mot de passe oublié » ou une invitation.
 * Les plats existants du même nom sont mis à jour, jamais dupliqués ; aucun plat n'est supprimé.
 *
 * Usage : MONGO_URI=... PARTNER=osaveurs-annemasse node scripts/seed-partner.js
 */
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const EXPECTED_DB = process.env.EXPECT_DB || 'afroeat_staging';

const loadPartner = (key) => {
  if (!/^[a-z0-9-]{3,60}$/.test(String(key || ''))) throw new Error('Clé de partenaire invalide.');
  const file = path.join(__dirname, '..', 'data', 'partners', `${key}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.owner?.email || !data.restaurant?.name || !Array.isArray(data.items)) {
    throw new Error('Fichier partenaire incomplet (owner.email, restaurant.name, items).');
  }
  for (const item of data.items) {
    if (!item.name || !Number.isFinite(item.price) || item.price < 0) {
      throw new Error(`Plat invalide : ${JSON.stringify(item)}`);
    }
  }
  return data;
};

const main = async () => {
  const data = loadPartner(process.env.PARTNER);
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI manquant.');
  await mongoose.connect(process.env.MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) {
    throw new Error(`Refusé : base « ${mongoose.connection.name} » au lieu de « ${EXPECTED_DB} ».`);
  }

  const email = data.owner.email.trim().toLowerCase();
  let owner = await User.findOne({ email }).select('_id role');
  if (owner && owner.role !== 'restaurant') {
    throw new Error(`Un compte ${owner.role} existe déjà avec ${email} : rien n'est modifié.`);
  }
  if (!owner) {
    owner = await User.create({
      name: data.owner.name,
      email,
      password: `${crypto.randomBytes(24).toString('hex')}aA1!`, // jamais affiché ni conservé
      role: 'restaurant',
      phone: data.owner.phone || '',
      address: data.restaurant.address || '',
      country: data.restaurant.country || '',
      accountStatus: 'active',
    });
    console.log('Compte propriétaire créé (mot de passe aléatoire non conservé).');
  }

  const existing = await Restaurant.findOne({ owner: owner._id, name: data.restaurant.name }).select('_id isActive');
  const { location, ...fields } = data.restaurant;
  const restaurant = await Restaurant.findOneAndUpdate(
    { owner: owner._id, name: data.restaurant.name },
    {
      $set: {
        ...fields,
        owner: owner._id,
        ...(location ? { location: { ...location, updatedAt: new Date() } } : {}),
      },
      // Création : masquée ; mise à jour : on ne touche pas à l'activation choisie par l'admin.
      ...(existing ? {} : { $setOnInsert: { isActive: false, isOpen: true } }),
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  // Fiche d'annuaire du même commerce (clé OSM/curated) : liée au partenaire pour éviter le doublon.
  if (data.claimsPlace) {
    const Place = require('../models/Place');
    const claimed = await Place.updateOne({ osmKey: data.claimsPlace }, { $set: { claimedRestaurant: restaurant._id } });
    console.log(claimed.matchedCount ? `Fiche d'annuaire « ${data.claimsPlace} » reliée au partenaire.` : `Fiche d'annuaire « ${data.claimsPlace} » introuvable.`);
  }

  let created = 0;
  let updated = 0;
  for (const item of data.items) {
    const result = await MenuItem.updateOne(
      { restaurant: restaurant._id, name: item.name },
      {
        $set: {
          restaurant: restaurant._id,
          name: item.name,
          price: item.price,
          category: item.category || 'Plats principaux',
          cuisine: data.restaurant.cuisine || 'Africaine',
          description: item.description || '',
          containsAlcohol: item.containsAlcohol === true,
          isPopular: item.isPopular === true,
          available: true,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) created += 1;
    else if (result.modifiedCount) updated += 1;
  }

  console.log(
    `« ${restaurant.name} » (${restaurant._id}) : ${created} plat(s) créé(s), ${updated} mis à jour, ` +
      `fiche ${restaurant.isActive ? 'VISIBLE' : 'MASQUÉE (à activer dans l’administration)'}.`
  );
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { loadPartner };
