'use strict';

// Crée (ou met à jour) un restaurant « TEST » avec un petit menu, dans une base de TEST.
// Usage : AFROEAT_ENV=staging MONGO_URI=... TEST_OWNER_PASSWORD=... node scripts/seed-test-restaurant.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const { TEST_OWNER_EMAIL, buildOwner, buildRestaurant, buildMenuItems } = require('../utils/testRestaurantSeed');

const main = async () => {
  if (String(process.env.AFROEAT_ENV || '').toLowerCase() !== 'staging') {
    console.error("Refusé : AFROEAT_ENV=staging est obligatoire (ce script ne doit jamais tourner sur la vraie base).");
    process.exit(1);
  }
  if (!process.env.MONGO_URI || !process.env.TEST_OWNER_PASSWORD) {
    console.error('Usage : MONGO_URI=... TEST_OWNER_PASSWORD=... node scripts/seed-test-restaurant.js');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  let owner = await User.findOne({ email: TEST_OWNER_EMAIL });
  if (!owner) {
    owner = await User.create(buildOwner(process.env.TEST_OWNER_PASSWORD));
    console.log(`Compte propriétaire TEST créé : ${TEST_OWNER_EMAIL}`);
  } else {
    console.log(`Compte propriétaire TEST déjà présent : ${TEST_OWNER_EMAIL}`);
  }

  const restaurantDoc = buildRestaurant(owner._id);
  const restaurant = await Restaurant.findOneAndUpdate(
    { owner: owner._id, name: restaurantDoc.name },
    { $set: restaurantDoc },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  console.log(`Restaurant TEST : ${restaurant.name} (${restaurant._id})`);

  await MenuItem.deleteMany({ restaurant: restaurant._id });
  await MenuItem.insertMany(buildMenuItems(restaurant._id));
  console.log('Menu TEST : 5 plats enregistrés.');

  await mongoose.disconnect();
};

main().catch((error) => { console.error(error); process.exit(1); });
