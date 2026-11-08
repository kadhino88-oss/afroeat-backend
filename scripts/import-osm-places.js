'use strict';

// Importe des lieux OpenStreetMap (GeoJSON séquentiel produit par osmium) dans MongoDB.
// Usage : MONGO_URI=... node scripts/import-osm-places.js <fichier.geojsonseq> <region>
require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const mongoose = require('mongoose');
const Place = require('../models/Place');
const { featureToPlace } = require('../utils/osmPlaces');

const BATCH = 1000;
const AFRICAN_ONLY = String(process.env.AFRICAN_ONLY || '').toLowerCase() === 'true';
// Protège la base : un cluster gratuit Atlas (M0) est limité à 512 Mo.
const MAX_DB_MB = Number(process.env.MAX_DB_MB || 400);

const main = async () => {
  const [file, region = ''] = process.argv.slice(2);
  if (!file || !process.env.MONGO_URI) {
    console.error('Usage : MONGO_URI=... node scripts/import-osm-places.js <fichier.geojsonseq> <region>');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  await Place.init();

  const stats = await mongoose.connection.db.command({ dbStats: 1, scale: 1024 * 1024 });
  const usedMb = Number(stats.dataSize || 0) + Number(stats.indexSize || 0);
  if (usedMb > MAX_DB_MB) {
    console.error(
      `Import annulé : la base utilise déjà ${Math.round(usedMb)} Mo (limite de sécurité ${MAX_DB_MB} Mo). ` +
      'Utilise « african_only », une région plus petite, ou passe à un cluster plus grand.'
    );
    process.exit(1);
  }
  const startedAt = new Date();

  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let ops = [];
  let seen = 0;
  let kept = 0;

  const flush = async () => {
    if (ops.length === 0) return;
    await Place.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const raw of lines) {
    const line = raw.replace(/^\u001e/, '').trim(); // séparateur RS du GeoJSON-seq
    if (!line) continue;
    seen += 1;
    let feature;
    try { feature = JSON.parse(line); } catch { continue; }
    const doc = featureToPlace(feature, region);
    if (!doc) continue;
    if (AFRICAN_ONLY && !doc.isAfrican) continue;
    kept += 1;
    ops.push({
      updateOne: {
        filter: { osmKey: doc.osmKey },
        update: { $set: { ...doc, importedAt: startedAt } },
        upsert: true,
      },
    });
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  // Supprime les lieux de cette région qui n'existent plus dans OpenStreetMap.
  const removed = region && kept > 0
    ? await Place.deleteMany({ region, importedAt: { $lt: startedAt } })
    : { deletedCount: 0 };

  console.log(`OSM ${region || '(sans région)'} : ${seen} éléments lus, ${kept} lieux importés${AFRICAN_ONLY ? ' (africains uniquement)' : ''}, ${removed.deletedCount} supprimés.`);
  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('Import OSM échoué :', error.message);
  process.exit(1);
});
