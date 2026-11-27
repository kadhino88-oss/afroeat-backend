'use strict';

/**
 * Restaurant d'ESSAI sur la base officielle, pour tester un vrai achat avant l'ouverture.
 * Il est clairement nommé « ESSAI D'ACHAT — À SUPPRIMER », propose un seul plat à 2,00 CHF, sans livraison payante.
 * Le compte propriétaire reçoit un mot de passe aléatoire jamais affiché : l'administrateur gère la fiche et les
 * commandes depuis l'administration (« Gérer le menu et les photos », changement de statut).
 *
 * Usage : MONGO_URI=... ACTION=create|remove node scripts/launch-test-restaurant.js
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

const OWNER_EMAIL = 'restaurant-essai@afroeat.invalid';
const RESTAURANT_NAME = "ESSAI D'ACHAT — À SUPPRIMER";
const { expectedDatabaseName, connectOfficialDatabase } = require('../utils/officialDatabase');
const EXPECTED_DB = expectedDatabaseName();

const main = async () => {
  const action = String(process.env.ACTION || 'create').toLowerCase();
  if (!process.env.MONGO_URI || !['create', 'remove'].includes(action)) {
    console.error('Usage : MONGO_URI=... ACTION=create|remove node scripts/launch-test-restaurant.js');
    process.exit(1);
  }
  await connectOfficialDatabase(mongoose, process.env.MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) {
    console.error(`Refusé : base « ${mongoose.connection.name} » au lieu de « ${EXPECTED_DB} ».`);
    process.exit(1);
  }

  const existingOwner = await User.findOne({ email: OWNER_EMAIL }).select('_id');

  if (action === 'remove') {
    const restaurants = existingOwner ? await Restaurant.find({ owner: existingOwner._id }).select('_id') : [];
    const ids = restaurants.map((r) => r._id);
    const items = await MenuItem.deleteMany({ restaurant: { $in: ids } });
    await Restaurant.deleteMany({ _id: { $in: ids } });
    if (existingOwner) await User.deleteOne({ _id: existingOwner._id });
    console.log(`Restaurant d'essai retiré : ${ids.length} fiche, ${items.deletedCount} plat, compte propriétaire supprimé.`);
    await mongoose.disconnect();
    return;
  }

  let owner = existingOwner;
  if (!owner) {
    owner = await User.create({
      name: 'Propriétaire essai',
      email: OWNER_EMAIL,
      password: `${crypto.randomBytes(24).toString('hex')}aA1!`, // jamais affiché ni conservé
      role: 'restaurant',
      phone: '+41220000000',
      address: 'Rue du Rhône 1, 1204 Genève',
      country: 'Suisse',
      accountStatus: 'active',
      isIdentityVerified: true,
      isWorkAuthorized: true,
    });
    console.log('Compte propriétaire d’essai créé (mot de passe aléatoire non conservé).');
  }

  const restaurant = await Restaurant.findOneAndUpdate(
    { owner: owner._id, name: RESTAURANT_NAME },
    {
      $set: {
        owner: owner._id,
        name: RESTAURANT_NAME,
        description: "Fiche d'essai pour vérifier un achat avant l'ouverture. Aucun plat réel n'est préparé : elle sera supprimée.",
        cuisine: 'Africaine',
        businessType: 'restaurant',
        phone: '+41220000000',
        address: 'Rue du Rhône 1, 1204 Genève',
        city: 'Genève',
        country: 'Suisse',
        postalCode: '1204',
        currency: 'CHF',
        deliveryFee: 0,
        minimumOrderAmount: 0,
        averagePreparationTimeMinutes: 15,
        isActive: true,
        isOpen: true,
        location: { latitude: 46.2044, longitude: 6.1432, updatedAt: new Date() },
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  await MenuItem.findOneAndUpdate(
    { restaurant: restaurant._id, name: "Plat d'essai (à supprimer)" },
    {
      $set: {
        restaurant: restaurant._id,
        name: "Plat d'essai (à supprimer)",
        price: 2,
        category: 'Plats principaux',
        cuisine: 'Africaine',
        description: "Article d'essai à 2,00 CHF pour tester le paiement.",
        available: true,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`Restaurant d’essai prêt : « ${restaurant.name} » (${restaurant._id}), 1 plat à 2,00 CHF.`);
  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
