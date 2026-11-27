'use strict';

// Copie des collections choisies d'une base vers une autre DU MÊME CLUSTER, sans jamais modifier ni supprimer la cible.
//
// Usage : MONGO_URI=... node scripts/migrate-between-databases.js --from afroeat_staging --to afroeatDB \
//           --collections restaurants,menuitems [--apply] [--include-users --confirm-users afroeatDB]
//
// - SIMULATION par défaut : compte, par collection, les documents de la source, ceux déjà présents dans la cible
//   (par _id) et ceux à copier. Rien n'est écrit sans --apply.
// - --collections est obligatoire ; seules les collections des modèles du dépôt sont autorisées.
// - users n'est copiée qu'avec --include-users (et, avec --apply, --confirm-users <base cible>).
// - La cible doit égaler AFROEAT_MONGO_DB_NAME quand elle est définie, et ne jamais être une base staging/test/dev.
// - Seuls les documents dont l'_id est absent de la cible sont insérés (insertMany ordered:false, doublons ignorés).
// - Aucun contenu de document n'est affiché. Les index ne sont PAS copiés : lancer ensuite `npm run db:sync-indexes`.
require('dotenv').config();
const mongoose = require('mongoose');
const {
  deriveAllowedCollections, parseMigrationArgs, validateMigrationRequest, runMigration,
} = require('../utils/databaseMigration');

const fail = (message) => {
  console.error(`Refusé : ${message}`);
  process.exit(1);
};

const main = async () => {
  const args = parseMigrationArgs(process.argv.slice(2));
  const allowedCollections = deriveAllowedCollections();
  const check = validateMigrationRequest(args, { env: process.env, allowedCollections });
  if (!check.ok) {
    console.error(`Refusé : ${check.error}`);
    console.error(`Collections autorisées : ${allowedCollections.join(', ')}`);
    process.exit(1);
  }
  const uri = String(process.env.MONGO_URI || '').trim();
  if (!uri) fail('MONGO_URI est requis.');

  console.log(args.apply ? 'Mode APPLY : les documents absents de la cible sont insérés.' : 'Mode simulation : aucune écriture (ajouter --apply pour écrire).');
  console.log(`Source : ${args.from} -> cible : ${args.to}`);
  console.log(`Collections : ${args.collections.join(', ')}`);
  for (const warning of check.warnings) console.warn(`ATTENTION ${warning.collection} : ${warning.message}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  let results;
  try {
    results = await runMigration({
      client: mongoose.connection.getClient(),
      from: args.from, to: args.to, collections: args.collections, apply: args.apply, batchSize: args.batchSize,
    });
  } finally {
    await mongoose.disconnect();
  }

  let failed = false;
  for (const r of results) {
    console.log(`${r.collection}: source ${r.source}, déjà présents ${r.alreadyPresent}, à copier ${r.toCopy}`
      + (args.apply ? `, copiés ${r.copied}, conflits d'index unique (non copiés) ${r.uniqueConflicts}` : ''));
    if (r.errors) {
      failed = true;
      console.error(`${r.collection}: erreur (code ${r.errorCode ?? 'inconnu'}), collection interrompue.`);
    }
  }
  console.log('Les index ne sont pas copiés : lancer `npm run db:sync-indexes` sur la cible.');
  if (!args.apply) console.log('Simulation terminée : rien n\'a été écrit.');
  if (failed) process.exit(1);
};

main().catch(async (error) => {
  console.error(`Migration interrompue (${error?.name || 'Error'}).`); // jamais error.message : peut citer des valeurs
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
