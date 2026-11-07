/**
 * Charge (ou retire avec --remove) des commerces de DÉMONSTRATION à Genève,
 * uniquement dans une base de TEST (nom terminant par _staging).
 *
 * Usage : MONGO_URI=... node seed/seedDemoStaging.js [--remove]
 * Idempotent : relancer le script ne crée pas de doublons.
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const {
  DEMO_OWNER,
  DEMO_BUSINESSES,
  assertStagingDatabase,
} = require('../data/demoStaging');

const withLocation = (restaurant) => ({
  ...restaurant,
  location: {
    latitude: restaurant.latitude,
    longitude: restaurant.longitude,
    updatedAt: new Date(),
  },
});

const ensureOwner = async () => {
  let owner = await User.findOne({ email: DEMO_OWNER.email });
  if (owner) return owner;

  // Mot de passe aléatoire, jamais affiché : ce compte ne sert qu'à « posséder » les commerces.
  owner = await User.create({
    ...DEMO_OWNER,
    password: crypto.randomBytes(24).toString('hex'),
    accountStatus: 'active',
    isIdentityVerified: true,
  });
  return owner;
};

const seed = async () => {
  const owner = await ensureOwner();
  let restaurants = 0;
  let items = 0;

  for (const business of DEMO_BUSINESSES) {
    const restaurant = await Restaurant.findOneAndUpdate(
      { owner: owner._id, name: business.restaurant.name },
      { $set: { ...withLocation(business.restaurant), owner: owner._id } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    restaurants += 1;

    for (const item of business.items) {
      await MenuItem.findOneAndUpdate(
        { restaurant: restaurant._id, name: item.name },
        { $set: { available: true, image: '', ...item, restaurant: restaurant._id } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      items += 1;
    }
  }

  console.log(`✅ Démo chargée : ${restaurants} commerces, ${items} articles.`);
};

const remove = async () => {
  const owner = await User.findOne({ email: DEMO_OWNER.email });
  if (!owner) {
    console.log('Aucune donnée de démonstration à retirer.');
    return;
  }

  const restaurants = await Restaurant.find({ owner: owner._id }).select('_id');
  const ids = restaurants.map((item) => item._id);
  const removedItems = await MenuItem.deleteMany({ restaurant: { $in: ids } });
  const removedRestaurants = await Restaurant.deleteMany({ owner: owner._id });
  await User.deleteOne({ _id: owner._id });

  console.log(
    `✅ Démo retirée : ${removedRestaurants.deletedCount} commerces, ${removedItems.deletedCount} articles.`
  );
};

const run = async () => {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('MONGO_URI manquant');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    assertStagingDatabase(mongoose.connection.name);
    console.log(`Base ciblée : ${mongoose.connection.name}`);
    if (process.argv.includes('--remove')) await remove();
    else await seed();
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  run().catch((error) => {
    console.error('❌', error.message);
    process.exit(1);
  });
}

module.exports = { run };
