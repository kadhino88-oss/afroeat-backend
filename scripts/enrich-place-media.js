'use strict';

/**
 * Récupère, pour chaque lieu public ayant un site web, l'image de partage et le logo de ce site
 * (balises og:image et icônes déclarées par le commerce lui-même). Une seule requête par site,
 * 8 s maximum, 1,5 Mo lus au plus, pas de nouvel essai avant 30 jours.
 *
 * Usage : MONGO_URI=... [LIMIT=300] [FORCE=1] node scripts/enrich-place-media.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Place = require('../models/Place');
const { extractSiteMedia } = require('../utils/siteMedia');

const EXPECTED_DB = process.env.EXPECT_DB || 'afroeat_staging';
const MAX_BYTES = 1500000;

const fetchHtml = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'AfroeatBot/1.0 (aperçu de commerce)', Accept: 'text/html' },
    });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    controller.abort();
    return { html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI manquant.');
  await mongoose.connect(process.env.MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) {
    throw new Error(`Refusé : base « ${mongoose.connection.name} » au lieu de « ${EXPECTED_DB} ».`);
  }
  const limit = Math.min(Number(process.env.LIMIT) || 300, 2000);
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const filter = { website: { $nin: ['', null] } };
  if (process.env.FORCE !== '1') filter.$or = [{ mediaCheckedAt: null }, { mediaCheckedAt: { $lt: cutoff } }];
  const places = await Place.find(filter).select('_id name website').limit(limit).lean();
  let images = 0;
  let logos = 0;
  for (const place of places) {
    let website = String(place.website).trim();
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    const page = await fetchHtml(website);
    const media = page ? extractSiteMedia(page.html, page.finalUrl) : { imageUrl: '', logoUrl: '' };
    await Place.updateOne(
      { _id: place._id },
      { $set: { imageUrl: media.imageUrl, logoUrl: media.logoUrl, mediaCheckedAt: new Date() } }
    );
    if (media.imageUrl) images += 1;
    if (media.logoUrl) logos += 1;
  }
  console.log(`${places.length} site(s) consulté(s) : ${images} image(s) de présentation, ${logos} logo(s).`);
  await mongoose.disconnect();
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
