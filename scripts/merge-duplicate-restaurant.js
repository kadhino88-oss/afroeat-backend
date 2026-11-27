'use strict';

/**
 * Fusionne un doublon de commerce : le menu et les visuels de l'ancienne fiche passent sur la fiche
 * à conserver, puis l'ancienne fiche (et son compte propriétaire provisoire) est supprimée.
 * Sans APPLY=true, rien n'est modifié : le script affiche seulement ce qu'il ferait.
 * Refus si l'ancienne fiche a une commande payée (historique financier à conserver).
 *
 * Usage : MONGO_URI=... KEEP_ID=... REMOVE_ID=... [APPLY=true] node scripts/merge-duplicate-restaurant.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const OrderMessage = require('../models/OrderMessage');
const Review = require('../models/Review');

const { expectedDatabaseName, connectOfficialDatabase } = require('../utils/officialDatabase');
const EXPECTED_DB = expectedDatabaseName();
const COPY_IF_EMPTY = ['logo', 'image', 'description'];

const main = async () => {
  const { KEEP_ID, REMOVE_ID, MONGO_URI } = process.env;
  const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
  if (!MONGO_URI) throw new Error('MONGO_URI manquant.');
  if (!mongoose.isValidObjectId(KEEP_ID) || !mongoose.isValidObjectId(REMOVE_ID) || KEEP_ID === REMOVE_ID) {
    throw new Error('KEEP_ID et REMOVE_ID doivent être deux identifiants différents.');
  }
  await connectOfficialDatabase(mongoose, MONGO_URI);
  if (mongoose.connection.name !== EXPECTED_DB) {
    throw new Error(`Refusé : base « ${mongoose.connection.name} » au lieu de « ${EXPECTED_DB} ».`);
  }

  const keep = await Restaurant.findById(KEEP_ID);
  const old = await Restaurant.findById(REMOVE_ID);
  if (!keep || !old) throw new Error('Une des deux fiches est introuvable.');
  console.log(`À CONSERVER : ${keep.name} (${keep._id}) — propriétaire ${keep.owner}`);
  console.log(`À SUPPRIMER : ${old.name} (${old._id}) — propriétaire ${old.owner}`);

  const paid = await Order.countDocuments({ restaurant: old._id, paymentStatus: { $in: ['Payé', 'Remboursé'] } });
  if (paid > 0) throw new Error(`Refusé : ${paid} commande(s) payée(s) sur l'ancienne fiche (historique à conserver).`);

  const oldItems = await MenuItem.find({ restaurant: old._id }).select('name');
  const keepNames = new Set((await MenuItem.find({ restaurant: keep._id }).select('name')).map((i) => i.name));
  const toMove = oldItems.filter((i) => !keepNames.has(i.name));
  const orders = await Order.find({ restaurant: old._id }).select('_id');
  const orderIds = orders.map((o) => o._id);
  const copies = COPY_IF_EMPTY.filter((f) => !keep[f] && old[f]);
  const otherRestaurants = await Restaurant.countDocuments({ owner: old.owner, _id: { $ne: old._id } });
  const ownerUser = await User.findById(old.owner).select('role name');
  const deleteOwner = Boolean(ownerUser) && ownerUser.role === 'restaurant' && otherRestaurants === 0;

  console.log(`Plats à déplacer : ${toMove.length} sur ${oldItems.length} (les doublons de nom restent sur l'ancienne fiche, supprimés avec elle)`);
  console.log(`Champs copiés (vides sur la fiche conservée) : ${copies.join(', ') || 'aucun'}`);
  console.log(`Commandes de test supprimées : ${orderIds.length}`);
  console.log(`Compte propriétaire provisoire supprimé : ${deleteOwner ? ownerUser.name : 'non'}`);

  if (!apply) {
    console.log('SIMULATION : rien n\'a été modifié. Relancez avec apply=true pour appliquer.');
    return;
  }

  if (toMove.length) await MenuItem.updateMany({ _id: { $in: toMove.map((i) => i._id) } }, { $set: { restaurant: keep._id } });
  if (copies.length) {
    for (const f of copies) keep[f] = old[f];
    await keep.save();
  }
  await MenuItem.deleteMany({ restaurant: old._id });
  if (orderIds.length) {
    await OrderMessage.deleteMany({ order: { $in: orderIds } });
    await Review.deleteMany({ order: { $in: orderIds } });
    await Order.deleteMany({ _id: { $in: orderIds } });
  }
  await Review.deleteMany({ restaurant: old._id });
  await Restaurant.deleteOne({ _id: old._id });
  if (deleteOwner) await User.deleteOne({ _id: old.owner });
  console.log('TERMINÉ : fiche dupliquée supprimée, menu transféré.');
};

main()
  .then(() => mongoose.disconnect())
  .catch((error) => {
    console.error('ERREUR :', error.message);
    mongoose.disconnect().finally(() => process.exit(1));
  });
