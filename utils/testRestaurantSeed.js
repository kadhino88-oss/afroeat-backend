'use strict';

/**
 * Données de démonstration pour l'environnement de TEST uniquement.
 * Aucune photo, aucun logo : seuls des textes. Le restaurant est marqué « TEST » dans son nom.
 */
const TEST_OWNER_EMAIL = 'restaurant-test@afroeat.test';
const TEST_COURIER_EMAIL = 'livreur-test@afroeat.test';
const TEST_ADMIN_EMAIL = 'admin-test@afroeat.test';

const buildOwner = (password) => ({
  name: 'Propriétaire TEST',
  email: TEST_OWNER_EMAIL,
  password,
  role: 'restaurant',
  phone: '+41220000000',
  address: 'Rue du Rhône 1, 1204 Genève',
  country: 'Suisse',
  accountStatus: 'active',
  isIdentityVerified: true,
  isWorkAuthorized: true,
});

// Livreur de TEST : compte actif, identité et autorisation de travail « vérifiées », disponible,
// pour pouvoir tester l'assignation et la livraison sans passer par la vérification réelle.
const buildCourier = (password) => ({
  name: 'Livreur TEST',
  email: TEST_COURIER_EMAIL,
  password,
  role: 'livreur',
  phone: '+41220000001',
  address: 'Rue du Rhône 1, 1204 Genève',
  country: 'Suisse',
  accountStatus: 'active',
  isIdentityVerified: true,
  isWorkAuthorized: true,
  isAvailable: true,
  deliveryProfile: { vehicleType: 'Vélo' },
});

// Administrateur de TEST : sert à valider l'invitation des partenaires sur l'environnement de test.
const buildAdmin = (password) => ({
  name: 'Admin TEST',
  email: TEST_ADMIN_EMAIL,
  password,
  role: 'admin',
  phone: '+41220000002',
  address: 'Rue du Rhône 1, 1204 Genève',
  country: 'Suisse',
  accountStatus: 'active',
  isIdentityVerified: true,
  isWorkAuthorized: true,
});

const buildRestaurant = (ownerId) => ({
  owner: ownerId,
  name: 'TEST — Chez AfroEat (démo)',
  description: "Restaurant de démonstration pour tester le parcours de commande. Aucun vrai plat n'est préparé.",
  cuisine: 'Africaine',
  businessType: 'restaurant',
  phone: '+41220000000',
  address: 'Rue du Rhône 1, 1204 Genève',
  city: 'Genève',
  country: 'Suisse',
  postalCode: '1204',
  currency: 'CHF',
  deliveryFee: 3,
  minimumOrderAmount: 10,
  averagePreparationTimeMinutes: 25,
  isActive: true,
  isOpen: true,
  location: { latitude: 46.2044, longitude: 6.1432, updatedAt: new Date() },
});

const MENU = [
  { name: 'Poulet yassa (TEST)', price: 18, category: 'Plats principaux', cuisine: 'Sénégalaise', description: "Poulet mariné aux oignons et au citron, servi avec du riz." },
  { name: 'Thieboudienne (TEST)', price: 22, category: 'Plats principaux', cuisine: 'Sénégalaise', description: 'Riz au poisson et aux légumes.' },
  { name: 'Mafé (TEST)', price: 19, category: 'Plats principaux', cuisine: 'Malienne', description: "Ragoût à la pâte d'arachide." },
  { name: 'Alloco (TEST)', price: 7, category: 'Accompagnements', cuisine: 'Ivoirienne', description: 'Bananes plantains frites.' },
  { name: 'Bissap (TEST)', price: 4, category: 'Boissons', cuisine: 'Sénégalaise', description: "Infusion glacée d'hibiscus." },
];

const buildMenuItems = (restaurantId) =>
  MENU.map((item, index) => ({ ...item, restaurant: restaurantId, available: true, isPopular: index < 2 }));

module.exports = { TEST_OWNER_EMAIL, TEST_COURIER_EMAIL, TEST_ADMIN_EMAIL, buildOwner, buildCourier, buildAdmin, buildRestaurant, buildMenuItems, MENU };
