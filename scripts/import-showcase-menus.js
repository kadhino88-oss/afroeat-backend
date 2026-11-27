'use strict';

/**
 * Affiche des menus INDICATIFS (data/showcase/menus.js) pour des commerces qui ont un site public, en phase de test.
 * Simulation par défaut : n'écrit rien. Avec APPLY=true, et seulement sur la base officielle :
 *  - fiche déjà présente sans menu : ajoute les plats ;
 *  - sinon, lieu d'annuaire unique correspondant : crée une fiche d'AFFICHAGE (compte propriétaire « vitrine » SUSPENDU,
 *    jamais utilisable), la relie au lieu (qui n'est plus listé deux fois) et ajoute les plats ;
 *  - dans tous les cas la fiche est fermée (isOpen=false) et porte « menu indicatif, non partenaire » : aucune commande.
 * Texte et prix de la page publique uniquement ; les visuels déjà affichés pour le lieu (logo, image de partage) sont
 * simplement référencés, aucun fichier n'est copié.
 * Garde-fous : une fiche qui a déjà un menu n'est jamais modifiée ; un partenaire actif ET ouvert n'est jamais touché ;
 * un nom ambigu est ignoré ; rien n'est supprimé.
 *
 * Usage : MONGO_URI=... [APPLY=true] node scripts/import-showcase-menus.js
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const Place = require('../models/Place');
const MENUS = require('../data/showcase/menus');
const { currencyFor } = require('../utils/partnerRestaurant');
const { connectOfficialDatabase } = require('../utils/officialDatabase');

const NOTICE = "Menu indicatif recopié du site public du restaurant (phase de test). Ce restaurant n'est pas partenaire AfroEat : commande indisponible.";
const SHOWCASE_OWNER_EMAIL = 'vitrine-menus-indicatifs@afroeat.invalid';
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safePhone = (value) => (/^[+0-9 ().-]{6,30}$/.test(String(value || '')) ? String(value) : '');
const safeUrl = (value) => (/^https:\/\/[^\s]{4,1190}$/.test(String(value || '')) ? String(value) : '');

const planImport = ({ spec, restaurants = [], places = [], itemCount = 0, owner = null }) => {
  if (restaurants.length > 1) return { action: 'skip', reason: `ambigu : ${restaurants.length} fiches correspondent` };
  if (restaurants.length === 1) {
    const restaurant = restaurants[0];
    const id = String(restaurant._id);
    if (itemCount > 0) return { action: 'skip', reason: `a déjà ${itemCount} plat(s)`, restaurantId: id };
    const liveOrderable = restaurant.isActive !== false && restaurant.isOpen === true && owner?.accountStatus === 'active';
    if (liveOrderable) return { action: 'skip', reason: 'partenaire actif et ouvert : on n’y touche pas', restaurantId: id };
    return { action: 'import', mode: 'fiche existante', restaurantId: id, items: spec.items.length };
  }
  if (places.length === 0) return { action: 'skip', reason: 'ni fiche ni lieu d’annuaire' };
  if (places.length > 1) return { action: 'skip', reason: `ambigu : ${places.length} lieux d’annuaire correspondent` };
  if (places[0].claimedRestaurant) return { action: 'skip', reason: 'lieu déjà repris par une fiche' };
  return { action: 'import', mode: 'création depuis le lieu d’annuaire', placeId: String(places[0]._id), items: spec.items.length };
};

const ensureShowcaseOwner = async () => {
  const existing = await User.findOne({ email: SHOWCASE_OWNER_EMAIL }).select('_id role accountStatus');
  if (existing) {
    if (existing.role !== 'restaurant' || existing.accountStatus !== 'suspended') {
      throw new Error('Le compte vitrine existe mais n’est pas un compte restaurant suspendu : arrêt par prudence.');
    }
    return existing;
  }
  return User.create({
    name: 'Vitrine menus indicatifs',
    email: SHOWCASE_OWNER_EMAIL,
    password: `${crypto.randomBytes(24).toString('hex')}aA1!`, // jamais affiché ni conservé
    role: 'restaurant',
    phone: '',
    address: '',
    country: '',
    accountStatus: 'suspended', // refuse toute commande (isRestaurantOwnerActive) et toute connexion
  });
};

const main = async () => {
  const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
  if (!process.env.MONGO_URI) {
    console.error('Usage : MONGO_URI=... [APPLY=true] node scripts/import-showcase-menus.js');
    process.exit(1);
  }
  const dbName = await connectOfficialDatabase(mongoose, process.env.MONGO_URI);
  console.log(`Base : ${dbName} — ${apply ? 'ÉCRITURE' : 'SIMULATION (rien n’est écrit)'}`);

  for (const spec of MENUS) {
    const nameFilter = { name: new RegExp(escapeRegex(spec.token), 'i') };
    const restaurants = await Restaurant.find(nameFilter).select('name city country currency isOpen isActive owner description').limit(5).lean();
    const places = restaurants.length
      ? []
      : await Place.find({ ...nameFilter, kind: { $in: ['restaurant', 'fast_food'] } })
        .select('name city address phone website cuisine imageUrl logoUrl location claimedRestaurant')
        .limit(5)
        .lean();
    const chosen = restaurants.length === 1 ? restaurants[0] : null;
    const owner = chosen?.owner ? await User.findById(chosen.owner).select('role accountStatus').lean() : null;
    const itemCount = chosen ? await MenuItem.countDocuments({ restaurant: chosen._id }) : 0;
    const plan = planImport({ spec, restaurants, places, itemCount, owner });

    console.log(`\n== ${spec.key} (${spec.items.length} plats prévus, pays prévu : ${spec.country})`);
    restaurants.forEach((c) => console.log(`   fiche : « ${c.name} » ${c._id} — ${c.city || '?'} ${c.country || ''} ${c.currency || ''} — isActive=${c.isActive} isOpen=${c.isOpen}`));
    places.forEach((p) => console.log(`   lieu d'annuaire : « ${p.name} » ${p._id} — ${p.address || '?'}, ${p.city || '?'} — tél ${p.phone || '-'} — site ${p.website || '-'} — logo ${p.logoUrl ? 'oui' : 'non'}, image ${p.imageUrl ? 'oui' : 'non'} — repris : ${p.claimedRestaurant || 'non'}`));
    if (chosen) console.log(`   propriétaire : ${owner ? `${owner.role} / ${owner.accountStatus}` : 'introuvable'} — plats existants : ${itemCount}`);
    console.log(`   décision : ${plan.action === 'import' ? `IMPORTER (${plan.mode})` : `ignorer (${plan.reason})`}`);

    if (plan.action !== 'import' || !apply) continue;

    let restaurantId = chosen?._id;
    let description = chosen ? (chosen.description || '') : '';
    if (!chosen) {
      const place = places[0];
      const showcaseOwner = await ensureShowcaseOwner();
      const [lng, lat] = place.location?.coordinates || [];
      const created = await Restaurant.create({
        owner: showcaseOwner._id,
        name: place.name,
        description: NOTICE,
        cuisine: spec.cuisine,
        businessType: 'restaurant',
        phone: safePhone(place.phone),
        address: place.address || '',
        city: place.city || '',
        country: spec.country,
        currency: currencyFor(spec.country),
        image: safeUrl(place.imageUrl),
        logo: safeUrl(place.logoUrl),
        deliveryFee: 0,
        minimumOrderAmount: 0,
        isActive: true, // visible (la fiche d'annuaire est masquée) ; non commandable : fermée + propriétaire suspendu
        isOpen: false,
        ...(Number.isFinite(lat) && Number.isFinite(lng) ? { location: { latitude: lat, longitude: lng, updatedAt: new Date() } } : {}),
      });
      restaurantId = created._id;
      description = NOTICE;
      await Place.updateOne({ _id: place._id }, { $set: { claimedRestaurant: created._id } });
      console.log(`   ✔ fiche d'affichage créée (${created._id}), lieu d'annuaire relié.`);
    }

    await MenuItem.insertMany(
      spec.items.map((i) => ({
        restaurant: restaurantId,
        name: i.name,
        price: i.price,
        category: i.category,
        description: i.description || '',
        cuisine: spec.cuisine,
        available: true,
        containsAlcohol: false,
      })),
      { ordered: true }
    );
    if (chosen) {
      const merged = description.includes(NOTICE) ? description : `${NOTICE}\n\n${description}`.trim().slice(0, 2000);
      await Restaurant.updateOne({ _id: restaurantId }, { $set: { isOpen: false, description: merged } });
    }
    console.log(`   ✔ ${spec.items.length} plats ajoutés ; fiche fermée et marquée « menu indicatif ».`);
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { planImport, NOTICE, SHOWCASE_OWNER_EMAIL };
