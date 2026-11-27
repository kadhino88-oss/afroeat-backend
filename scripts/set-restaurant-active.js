'use strict';

/** Active/masque un commerce et, si OPEN est fourni, l'ouvre/ferme aux commandes :
 *  MONGO_URI=... RESTAURANT_ID=... ACTIVE=true|false [OPEN=true|false] node scripts/set-restaurant-active.js */
require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');

const { expectedDatabaseName, connectOfficialDatabase } = require('../utils/officialDatabase');
const EXPECTED_DB = expectedDatabaseName();

const main = async () => {
  const { MONGO_URI, RESTAURANT_ID } = process.env;
  const active = String(process.env.ACTIVE || '').toLowerCase() === 'true';
  if (!MONGO_URI || !mongoose.isValidObjectId(RESTAURANT_ID)) throw new Error('MONGO_URI et RESTAURANT_ID valides requis.');
  await connectOfficialDatabase(mongoose, MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) throw new Error(`Refusé : base « ${mongoose.connection.name} ».`);
  const update = { isActive: active };
  const openInput = String(process.env.OPEN || '').trim().toLowerCase();
  if (openInput === 'true' || openInput === 'false') update.isOpen = openInput === 'true';
  for (const [env, field] of [['DELIVERY_FEE', 'deliveryFee'], ['MIN_ORDER', 'minimumOrderAmount']]) {
    const raw = String(process.env[env] || '').trim();
    if (raw !== '') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${env} invalide.`);
      update[field] = value;
    }
  }
  const result = await Restaurant.updateOne({ _id: RESTAURANT_ID }, { $set: update });
  console.log(`${JSON.stringify(update)} : ${result.matchedCount} fiche(s) trouvée(s), ${result.modifiedCount} modifiée(s).`);
};

main()
  .then(() => mongoose.disconnect())
  .catch((error) => {
    console.error('ERREUR :', error.message);
    mongoose.disconnect().finally(() => process.exit(1));
  });
