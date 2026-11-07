/**
 * Données de DÉMONSTRATION pour la base de TEST uniquement (Genève).
 * Tout est fictif et clairement étiqueté « [DÉMO] » : aucun de ces commerces
 * n'existe, aucune adresse n'est réelle, aucun contact n'est joignable.
 */

const DEMO_PREFIX = '[DÉMO] ';
const DEMO_NOTICE = 'Donnée de démonstration — établissement fictif, ne pas commander.';

const DEMO_OWNER = {
  name: `${DEMO_PREFIX}Compte partenaire`,
  // Domaine .invalid : ne peut jamais recevoir de courrier.
  email: 'demo-partenaire@afroeat.invalid',
  role: 'restaurant',
};

const baseRestaurant = {
  country: 'Suisse',
  city: 'Genève',
  currency: 'CHF',
  deliveryFee: 5,
  minimumOrderAmount: 20,
  averagePreparationTimeMinutes: 25,
  isOpen: true,
  isActive: true,
  phone: '+41 00 000 00 00',
};

const DEMO_BUSINESSES = [
  {
    restaurant: {
      ...baseRestaurant,
      name: `${DEMO_PREFIX}Chez Awa`,
      description: `${DEMO_NOTICE} Cuisine ivoirienne.`,
      cuisine: 'Ivoirienne',
      businessType: 'restaurant',
      categories: ['Plats principaux', 'Grillades'],
      address: 'Rue de Démo 1, 1201 Genève',
      postalCode: '1201',
      latitude: 46.2105,
      longitude: 6.1425,
      isFeatured: true,
    },
    items: [
      { name: 'Poulet braisé', description: 'Poulet mariné aux épices, grillé. (démo)', price: 22.5, category: 'Plats principaux', cuisine: 'Ivoirienne', isPopular: true },
      { name: 'Attiéké poisson', description: 'Attiéké servi avec poisson frit et sauce piment. (démo)', price: 24, category: 'Plats principaux', cuisine: 'Ivoirienne', isRecommended: true },
      { name: 'Alloco', description: 'Bananes plantain frites. (démo)', price: 8, category: 'Accompagnements', cuisine: 'Ivoirienne' },
      { name: 'Jus de bissap', description: 'Boisson à l’hibiscus, 33 cl. (démo)', price: 4.5, category: 'Boissons', cuisine: 'Ivoirienne' },
    ],
  },
  {
    restaurant: {
      ...baseRestaurant,
      name: `${DEMO_PREFIX}Maison Teranga`,
      description: `${DEMO_NOTICE} Cuisine sénégalaise.`,
      cuisine: 'Sénégalaise',
      businessType: 'restaurant',
      categories: ['Plats principaux'],
      address: 'Avenue de Démo 2, 1202 Genève',
      postalCode: '1202',
      latitude: 46.2189,
      longitude: 6.1531,
    },
    items: [
      { name: 'Thiéboudienne', description: 'Riz au poisson et légumes. (démo)', price: 26, category: 'Plats principaux', cuisine: 'Sénégalaise', isPopular: true },
      { name: 'Yassa poulet', description: 'Poulet aux oignons et citron. (démo)', price: 23, category: 'Plats principaux', cuisine: 'Sénégalaise' },
      { name: 'Jus de gingembre', description: 'Boisson maison, 33 cl. (démo)', price: 4.5, category: 'Boissons', cuisine: 'Sénégalaise' },
    ],
  },
  {
    restaurant: {
      ...baseRestaurant,
      name: `${DEMO_PREFIX}Épicerie Baobab`,
      description: `${DEMO_NOTICE} Épicerie africaine.`,
      cuisine: 'Africaine',
      businessType: 'grocery',
      categories: ['Épicerie'],
      address: 'Place de Démo 3, 1203 Genève',
      postalCode: '1203',
      latitude: 46.1996,
      longitude: 6.1368,
    },
    items: [
      { name: 'Farine de manioc (1 kg)', description: 'Farine de manioc. (démo)', price: 6.9, category: 'Épicerie', cuisine: 'Africaine' },
      { name: 'Piment en poudre (100 g)', description: 'Piment moulu. (démo)', price: 3.5, category: 'Épicerie', cuisine: 'Africaine' },
      { name: 'Plantains (kg)', description: 'Plantains mûrs. (démo)', price: 5.9, category: 'Épicerie', cuisine: 'Africaine' },
    ],
  },
  {
    restaurant: {
      ...baseRestaurant,
      name: `${DEMO_PREFIX}Bar à jus Soleil`,
      description: `${DEMO_NOTICE} Boissons africaines.`,
      cuisine: 'Africaine',
      businessType: 'drinks',
      categories: ['Boissons'],
      address: 'Quai de Démo 4, 1204 Genève',
      postalCode: '1204',
      latitude: 46.2058,
      longitude: 6.1559,
    },
    items: [
      { name: 'Jus de baobab', description: 'Jus de pain de singe, 33 cl. (démo)', price: 5, category: 'Boissons', cuisine: 'Africaine' },
      { name: 'Jus de mangue', description: 'Jus de mangue, 33 cl. (démo)', price: 4.5, category: 'Boissons', cuisine: 'Africaine' },
    ],
  },
];

/** La base ciblée doit être une base de TEST : on refuse tout autre nom. */
const isStagingDatabaseName = (name) => /_staging$/i.test(String(name || '').trim());

const assertStagingDatabase = (name) => {
  if (!isStagingDatabaseName(name)) {
    throw new Error(
      `Refus : la base « ${name || '(sans nom)'} » n'est pas une base de test (nom attendu : *_staging).`
    );
  }
};

module.exports = {
  DEMO_PREFIX,
  DEMO_NOTICE,
  DEMO_OWNER,
  DEMO_BUSINESSES,
  isStagingDatabaseName,
  assertStagingDatabase,
};
