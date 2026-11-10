'use strict';

// Crée (ou réinitialise) un compte admin de TEST pour les tests d'interface, avec un mot de passe aléatoire.
// Le mot de passe n'est jamais affiché en clair : il est chiffré avec la clé publique fournie
// (seul le détenteur de la clé privée peut le lire). Base de TEST uniquement.
// Usage : AFROEAT_ENV=staging MONGO_URI=... UI_PUBLIC_KEY_B64=... node scripts/create-ui-admin.js
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

const EMAIL = 'admin-ui@afroeat.test';

const main = async () => {
  if (String(process.env.AFROEAT_ENV || '').toLowerCase() !== 'staging') {
    console.error('Refusé : AFROEAT_ENV=staging est obligatoire.');
    process.exit(1);
  }
  const publicKey = Buffer.from(String(process.env.UI_PUBLIC_KEY_B64 || ''), 'base64').toString('utf8');
  if (!process.env.MONGO_URI || !publicKey.includes('PUBLIC KEY')) {
    console.error('MONGO_URI et UI_PUBLIC_KEY_B64 (clé publique PEM en base64) sont requis.');
    process.exit(1);
  }

  const password = `Ui-${crypto.randomBytes(9).toString('base64url')}#1a`;
  await mongoose.connect(process.env.MONGO_URI);

  let user = await User.findOne({ email: EMAIL }).select('+password');
  if (!user) {
    user = new User({
      name: 'Admin UI TEST',
      email: EMAIL,
      role: 'admin',
      phone: '+41220000003',
      address: 'Rue du Rhône 1, 1204 Genève',
      country: 'Suisse',
      accountStatus: 'active',
      isIdentityVerified: true,
      isWorkAuthorized: true,
    });
  }
  user.password = password;
  await user.save();
  await mongoose.disconnect();

  const sealed = crypto
    .publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(password))
    .toString('base64');
  console.log(`Compte ${EMAIL} prêt. Mot de passe chiffré :`);
  console.log(`SEALED:${sealed}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
