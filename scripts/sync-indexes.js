// Crée les index MongoDB déclarés dans les modèles (la production désactive autoIndex).
//
// Usage : MONGO_URI=... node scripts/sync-indexes.js [--prune] [--soft]
//   (défaut)  crée les index manquants, sans jamais en supprimer ;
//   --prune   synchronise aussi : SUPPRIME les index absents des modèles ;
//   --soft    pour le build Vercel : n'échoue jamais, et ne s'exécute que pour la
//             production (pas pour les aperçus de branches).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const args = new Set(process.argv.slice(2));
const soft = args.has('--soft');
const prune = args.has('--prune');

const run = async () => {
  if (soft && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    console.log(`Index : ignorés pour l'environnement « ${process.env.VERCEL_ENV} ».`);
    return;
  }

  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) throw new Error('MONGO_URI manquant');

  const modelsDir = path.join(__dirname, '..', 'models');
  fs.readdirSync(modelsDir)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => require(path.join(modelsDir, file)));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Base : ${mongoose.connection.name}`);

  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    if (prune) {
      const dropped = await model.syncIndexes();
      console.log(`✅ ${name}: index synchronisés${dropped.length ? ` (supprimés: ${dropped.join(', ')})` : ''}`);
    } else {
      await model.createIndexes();
      console.log(`✅ ${name}: index créés ou déjà présents`);
    }
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(`${soft ? '⚠️' : '❌'} Index non synchronisés =>`, error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(soft ? 0 : 1);
});
