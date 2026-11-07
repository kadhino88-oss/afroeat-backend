// Crée/synchronise les index MongoDB déclarés dans les modèles.
// À lancer une fois après la création d'une base (la production désactive autoIndex).
// Usage : MONGO_URI=... node scripts/sync-indexes.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const run = async () => {
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('MONGO_URI manquant');

  const modelsDir = path.join(__dirname, '..', 'models');
  fs.readdirSync(modelsDir)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => require(path.join(modelsDir, file)));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  for (const name of mongoose.modelNames()) {
    const dropped = await mongoose.model(name).syncIndexes();
    console.log(`✅ ${name}: index synchronisés`, dropped.length ? `(supprimés: ${dropped.join(', ')})` : '');
  }

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error('❌ Synchronisation des index impossible =>', error.message);
  process.exit(1);
});
