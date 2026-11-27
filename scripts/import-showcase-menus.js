'use strict';

/**
 * Ajoute des menus INDICATIFS (data/showcase/menus.js) à des fiches de restaurants déjà présentes et sans menu.
 * Simulation par défaut : n'écrit rien. Avec APPLY=true, et seulement sur la base officielle :
 *  - ajoute les plats (texte et prix de la page publique du restaurant ; aucune photo) ;
 *  - ferme la fiche (isOpen=false) et y inscrit « menu indicatif, non partenaire » : aucune commande possible.
 * Garde-fous : une fiche qui a déjà un menu n'est jamais modifiée ; un partenaire actif ET ouvert n'est jamais touché ;
 * un nom ambigu (plusieurs fiches) est ignoré. Rien n'est supprimé, aucune autre fiche n'est créée.
 *
 * Usage : MONGO_URI=... [APPLY=true] node scripts/import-showcase-menus.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');
const User = require('../models/User');
const MENUS = require('../data/showcase/menus');
const { connectOfficialDatabase } = require('../utils/officialDatabase');

const NOTICE = "Menu indicatif recopié du site public du restaurant (phase de test). Ce restaurant n'est pas partenaire AfroEat : commande indisponible.";
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const planImport = ({ spec, candidates, itemCount, owner }) => {
  if (!candidates.length) return { action: 'skip', reason: 'fiche introuvable' };
  if (candidates.length > 1) return { action: 'skip', reason: `ambigu : ${candidates.length} fiches correspondent` };
  const restaurant = candidates[0];
  if (itemCount > 0) return { action: 'skip', reason: `a déjà ${itemCount} plat(s)`, restaurantId: String(restaurant._id) };
  const liveOrderable = restaurant.isActive !== false && restaurant.isOpen === true && owner?.accountStatus === 'active';
  if (liveOrderable) return { action: 'skip', reason: 'partenaire actif et ouvert : on n’y touche pas', restaurantId: String(restaurant._id) };
  return { action: 'import', restaurantId: String(restaurant._id), items: spec.items.length };
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
    const candidates = await Restaurant.find({ name: new RegExp(escapeRegex(spec.token), 'i') })
      .select('name city country currency isOpen isActive owner description')
      .limit(5)
      .lean();
    const chosen = candidates.length === 1 ? candidates[0] : null;
    const owner = chosen?.owner ? await User.findById(chosen.owner).select('role accountStatus').lean() : null;
    const itemCount = chosen ? await MenuItem.countDocuments({ restaurant: chosen._id }) : 0;
    const plan = planImport({ spec, candidates, itemCount, owner });

    console.log(`\n== ${spec.key} (${spec.items.length} plats prévus)`);
    candidates.forEach((c) => console.log(`   fiche : « ${c.name} » ${c._id} — ${c.city || '?'} ${c.country || ''} ${c.currency || ''} — isActive=${c.isActive} isOpen=${c.isOpen}`));
    if (chosen) console.log(`   propriétaire : ${owner ? `${owner.role} / ${owner.accountStatus}` : 'introuvable'} — plats existants : ${itemCount}`);
    console.log(`   décision : ${plan.action === 'import' ? 'IMPORTER' : `ignorer (${plan.reason})`}`);

    if (plan.action !== 'import' || !apply) continue;
    await MenuItem.insertMany(
      spec.items.map((i) => ({
        restaurant: chosen._id,
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
    const description = chosen.description?.includes(NOTICE) ? chosen.description : `${NOTICE}\n\n${chosen.description || ''}`.trim().slice(0, 2000);
    await Restaurant.updateOne({ _id: chosen._id }, { $set: { isOpen: false, description } });
    console.log(`   ✔ ${spec.items.length} plats ajoutés, fiche fermée et marquée « menu indicatif ».`);
  }
  await mongoose.disconnect();
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { planImport, NOTICE };
