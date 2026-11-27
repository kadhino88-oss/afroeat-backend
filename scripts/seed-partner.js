'use strict';

/**
 * Crée (ou met à jour) un commerce partenaire et son menu à partir de data/partners/<clé>.json.
 * La fiche est créée MASQUÉE (isActive=false) : l'administrateur vérifie les prix avec le partenaire,
 * puis l'active depuis l'administration. Le compte propriétaire reçoit un mot de passe aléatoire jamais
 * affiché : le partenaire le remplace via « Mot de passe oublié » ou une invitation.
 * Seuls les plats absents sont ajoutés : les plats existants (modifiés dans l'administration) ne sont jamais touchés.
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
const UploadedImage = require('../models/UploadedImage');

const { expectedDatabaseName, connectOfficialDatabase } = require('../utils/officialDatabase');
const EXPECTED_DB = expectedDatabaseName();
const PUBLIC_API_URL = String(process.env.PUBLIC_API_URL || 'https://afroeat-api-staging.vercel.app').replace(/\/+$/, '');
const MAX_MEDIA_BYTES = 900 * 1024;

/** Chemin de la photo d'illustration d'un plat (data/partners/media/<clé>/<fichier>.jpg), ou null. */
const mediaPath = (key, file) => {
  if (!file) return null;
  if (!/^[a-z0-9-]{1,80}\.jpg$/.test(String(file))) throw new Error(`Nom de photo invalide : ${file}`);
  return path.join(__dirname, '..', 'data', 'partners', 'media', key, file);
};

const loadPartner = (key) => {
  if (!/^[a-z0-9-]{3,60}$/.test(String(key || ''))) throw new Error('Clé de partenaire invalide.');
  const file = path.join(__dirname, '..', 'data', 'partners', `${key}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.owner?.email || !data.restaurant?.name || !Array.isArray(data.items)) {
    throw new Error('Fichier partenaire incomplet (owner.email, restaurant.name, items).');
  }
  for (const field of ['logoMedia', 'coverMedia']) {
    const file = mediaPath(key, data[field]);
    if (file && !fs.existsSync(file)) throw new Error(`Image introuvable : ${data[field]}`);
  }
  for (const item of data.items) {
    if (!item.name || !Number.isFinite(item.price) || item.price < 0) {
      throw new Error(`Plat invalide : ${JSON.stringify(item)}`);
    }
    const media = mediaPath(key, item.media);
    if (media && !fs.existsSync(media)) throw new Error(`Photo introuvable : ${item.media}`);
  }
  return data;
};

const main = async () => {
  const data = loadPartner(process.env.PARTNER);
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI manquant.');
  await connectOfficialDatabase(mongoose, process.env.MONGO_URI);
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
  // Fiche créée une seule fois (masquée) ; ensuite, la fiche modifiée dans l'administration n'est plus touchée.
  const restaurant = await Restaurant.findOneAndUpdate(
    { owner: owner._id, name: data.restaurant.name },
    {
      $setOnInsert: {
        ...fields,
        owner: owner._id,
        ...(location ? { location: { ...location, updatedAt: new Date() } } : {}),
        isActive: false,
        isOpen: true,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  if (existing) console.log('Fiche déjà existante : laissée telle quelle.');

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
        // Seulement à la création : une modification faite dans l'administration n'est jamais écrasée.
        $setOnInsert: {
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
    else updated += 1;
  }

  // Logo du commerce : posé seulement si la fiche n'en a pas encore (un logo choisi ensuite n'est jamais remplacé).
  const logoFile = mediaPath(process.env.PARTNER, data.logoMedia);
  if (logoFile) {
    const current = await Restaurant.findById(restaurant._id).select('logo');
    if (!current?.logo) {
      const bytes = fs.readFileSync(logoFile);
      const image = await UploadedImage.create({ owner: owner._id, contentType: 'image/jpeg', data: bytes, size: bytes.length });
      await Restaurant.updateOne(
        { _id: restaurant._id, logo: { $in: ['', null] } },
        { $set: { logo: `${PUBLIC_API_URL}/api/images/${image._id}` } }
      );
      console.log('Logo ajouté.');
    }
  }

  // Couverture : remplace seulement la couverture d'origine de l'import (ou une couverture vide) ;
  // une couverture choisie ensuite dans l'administration n'est jamais touchée.
  const coverFile = mediaPath(process.env.PARTNER, data.coverMedia);
  if (coverFile) {
    const current = await Restaurant.findById(restaurant._id).select('coverImage');
    const original = data.restaurant.coverImage || '';
    if (!current?.coverImage || current.coverImage === original) {
      const bytes = fs.readFileSync(coverFile);
      const image = await UploadedImage.create({ owner: owner._id, contentType: 'image/jpeg', data: bytes, size: bytes.length });
      await Restaurant.updateOne(
        { _id: restaurant._id, coverImage: { $in: ['', null, original] } },
        { $set: { coverImage: `${PUBLIC_API_URL}/api/images/${image._id}` } }
      );
      console.log('Couverture remplacée.');
    }
  }

  // Photos d'illustration : posées seulement sur les plats sans photo (une vraie photo n'est jamais remplacée).
  let illustrated = 0;
  for (const item of data.items) {
    const media = mediaPath(process.env.PARTNER, item.media);
    if (!media) continue;
    const menuItem = await MenuItem.findOne({ restaurant: restaurant._id, name: item.name }).select('_id image');
    if (!menuItem || menuItem.image) continue;
    const bytes = fs.readFileSync(media);
    if (bytes.length > MAX_MEDIA_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`Photo non conforme (JPEG ≤ 900 Ko) : ${item.media}`);
    }
    const image = await UploadedImage.create({ owner: owner._id, contentType: 'image/jpeg', data: bytes, size: bytes.length });
    await MenuItem.updateOne(
      { _id: menuItem._id, image: { $in: ['', null] } },
      { $set: { image: `${PUBLIC_API_URL}/api/images/${image._id}`, imageIsIllustration: true } }
    );
    illustrated += 1;
  }
  if (illustrated) console.log(`${illustrated} photo(s) d'illustration ajoutée(s).`);

  console.log(
    `« ${restaurant.name} » (${restaurant._id}) : ${created} plat(s) ajouté(s), ${updated} déjà présent(s) (inchangés), ` +
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

module.exports = { loadPartner, mediaPath };
