'use strict';

// Reconstruit les écritures du ledger (charge / refund / transfer / transfer_reversal) des commandes passées.
// Idempotent (clés d'idempotence partagées avec le code en direct) : peut être relancé sans risque de doublon.
// SIMULATION par défaut : rien n'est écrit sans --apply. Ne contacte jamais Stripe (pas de frais Stripe).
//
// Usage : MONGO_URI=... node scripts/backfill-ledger.js [--dry-run | --apply]
// Garde : refuse de tourner sur une autre base que celle attendue (EXPECT_DB ; défaut « afroeat_staging »).
require('dotenv').config();
const mongoose = require('mongoose');
const { backfillLedger, isExpectedDatabase, parseArgs } = require('../utils/ledgerBackfill');

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI est requis.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  if (!isExpectedDatabase(mongoose.connection.name)) {
    await mongoose.disconnect();
    console.error(`Refusé : base « ${mongoose.connection.name} ».`);
    process.exit(1);
  }

  console.log(args.apply ? 'Mode APPLY : les écritures manquantes sont créées.' : 'Mode simulation (--dry-run) : aucune écriture.');
  const report = await backfillLedger({ apply: args.apply });
  await mongoose.disconnect();
  console.log(`Commandes parcourues : ${report.ordersScanned}`);
  for (const [type, stats] of Object.entries(report.byType)) {
    console.log(`${type}: à créer ${stats.planned}, déjà présentes ${stats.existing}, créées ${stats.recorded}, erreurs ${stats.errors}`);
  }
};

main().catch(async (error) => {
  console.error(error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
