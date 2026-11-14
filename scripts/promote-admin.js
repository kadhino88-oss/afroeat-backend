'use strict';

// Donne le rôle administrateur à un compte EXISTANT, désigné par son identifiant.
// Le mot de passe n'est pas touché : le propriétaire le définit ensuite lui-même avec
// « Mot de passe oublié ». Rien de sensible n'est affiché (adresse masquée).
// Usage : MONGO_URI=... USER_ID=<identifiant du compte> node scripts/promote-admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const maskEmail = (email) => {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 2)}***@${domain}`;
};

const main = async () => {
  const userId = String(process.env.USER_ID || '').trim();
  if (!process.env.MONGO_URI || !mongoose.isValidObjectId(userId)) {
    console.error('MONGO_URI et USER_ID (identifiant de compte valide) sont requis.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findById(userId);
  if (!user) {
    await mongoose.disconnect();
    console.error('Compte introuvable : rien n’a été modifié.');
    process.exit(1);
  }
  if (user.accountStatus === 'suspended') {
    await mongoose.disconnect();
    console.error('Compte suspendu : refusé.');
    process.exit(1);
  }

  const previousRole = user.role;
  user.role = 'admin';
  user.accountStatus = 'active';
  await user.save();
  await mongoose.disconnect();
  console.log(`Compte ${maskEmail(user.email)} : rôle « ${previousRole} » → « admin ».`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
