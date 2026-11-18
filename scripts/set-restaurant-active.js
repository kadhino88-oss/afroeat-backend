'use strict';

/** Active ou masque un commerce : MONGO_URI=... RESTAURANT_ID=... ACTIVE=true|false node scripts/set-restaurant-active.js */
require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');

const EXPECTED_DB = process.env.EXPECT_DB || 'afroeat_staging';

const main = async () => {
  const { MONGO_URI, RESTAURANT_ID } = process.env;
  const active = String(process.env.ACTIVE || '').toLowerCase() === 'true';
  if (!MONGO_URI || !mongoose.isValidObjectId(RESTAURANT_ID)) throw new Error('MONGO_URI et RESTAURANT_ID valides requis.');
  await mongoose.connect(MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) throw new Error(`Refusé : base « ${mongoose.connection.name} ».`);
  const result = await Restaurant.updateOne({ _id: RESTAURANT_ID }, { $set: { isActive: active } });
  console.log(`isActive=${active} : ${result.matchedCount} fiche(s) trouvée(s), ${result.modifiedCount} modifiée(s).`);
};

main()
  .then(() => mongoose.disconnect())
  .catch((error) => {
    console.error('ERREUR :', error.message);
    mongoose.disconnect().finally(() => process.exit(1));
  });
