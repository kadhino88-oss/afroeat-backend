'use strict';

// Importe data/curated-african-places.json dans la collection Place (géocodage OpenStreetMap).
// Usage : MONGO_URI=... node scripts/import-curated-places.js
// INCLUDE_UNVERIFIED=true pour inclure aussi les lieux marqués "verified": false.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Place = require('../models/Place');
const { validateEntry, buildQuery, toPlaceDoc, makeKey } = require('../utils/curatedPlaces');

const INCLUDE_UNVERIFIED = String(process.env.INCLUDE_UNVERIFIED || 'false').toLowerCase() === 'true';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const geocode = async (entry) => {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(buildQuery(entry))}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'AfroEat-curated-import/1.0 (https://github.com/kadhino88-oss/afroeat-backend)' },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const [hit] = await response.json();
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon) };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    console.error('Usage : MONGO_URI=... node scripts/import-curated-places.js');
    process.exit(1);
  }
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'curated-african-places.json'), 'utf8'));

  await mongoose.connect(process.env.MONGO_URI);
  await Place.init();

  let imported = 0;
  for (const entry of entries) {
    const problem = validateEntry(entry);
    if (problem) { console.warn(`Ignoré (${problem}) :`, entry?.name); continue; }
    if (entry.verified === false && !INCLUDE_UNVERIFIED) {
      console.log(`À vérifier, non importé : ${entry.name} — ${entry.note || ''}`);
      continue;
    }
    try {
      const point = await geocode(entry);
      if (!point) { console.warn(`Adresse introuvable : ${entry.name} (${buildQuery(entry)})`); }
      else {
        const doc = toPlaceDoc(entry, point);
        await Place.updateOne({ osmKey: doc.osmKey }, { $set: doc }, { upsert: true });
        imported += 1;
        console.log(`OK : ${entry.name} (${makeKey(entry)}) → ${point.lat}, ${point.lng}`);
      }
    } catch (error) {
      console.warn(`Échec géocodage ${entry.name} :`, error.message);
    }
    await sleep(1200); // politique d'usage Nominatim : 1 requête / seconde
  }

  console.log(`Terminé : ${imported} lieu(x) importé(s).`);
  await mongoose.disconnect();
};

main().catch((error) => { console.error(error); process.exit(1); });
