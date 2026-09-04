const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

const {
  canAccessOrder,
  getOrders,
  getOrdersByUser,
  getOrdersByRestaurant,
  getOrderById,
  createOrder,
  updateOrderStatus,
  assignDriverToOrder,
  getOrderTracking,
  updateDriverLocation,
  deleteOrder,
} = require('../controllers/orderController');

/**
 * =========================================================
 * ORDER ROUTES — VERSION FINALE ROBUSTE
 * =========================================================
 *
 * Objectifs :
 * - structure claire et stable
 * - séparation propre auth / rôles / métier
 * - compatibilité complète client / restaurant / livreur / admin
 * - compatibilité totale avec tracking et livraison
 *
 * IMPORTANT :
 * - les routes spécifiques passent avant '/:id'
 * - aucune logique middleware ne reste dans le controller
 */

/**
 * =========================================================
 * LISTE GLOBALE DES COMMANDES SELON LE RÔLE
 * =========================================================
 *
 * GET /orders
 *
 * Comportement piloté dans le controller :
 * - client     => ses commandes
 * - livreur    => ses commandes assignées
 * - restaurant => commandes de ses restaurants
 * - admin      => toutes les commandes
 */
router.get('/', protect, getOrders);

/**
 * =========================================================
 * ALIAS LIVREUR / LIVRAISON
 * =========================================================
 *
 * GET /orders/delivery
 *
 * Route utilitaire premium pour le bloc livraison.
 * Réutilise la logique métier centralisée de getOrders.
 */
router.get('/delivery', protect, getOrders);

/**
 * =========================================================
 * COMMANDES D'UN UTILISATEUR
 * =========================================================
 *
 * GET /orders/user/:userId
 *
 * Réservé à l’admin.
 */
router.get('/user/:userId', protect, allowRoles('admin'), getOrdersByUser);

/**
 * =========================================================
 * COMMANDES D'UN RESTAURANT
 * =========================================================
 *
 * GET /orders/restaurant/:restaurantId
 *
 * Accessible à :
 * - admin
 * - restaurant
 */
router.get(
  '/restaurant/:restaurantId',
  protect,
  allowRoles('admin', 'restaurant'),
  getOrdersByRestaurant
);

/**
 * =========================================================
 * TRACKING D'UNE COMMANDE
 * =========================================================
 *
 * GET /orders/:id/tracking
 *
 * Payload tracking premium dédié au front live tracking.
 */
router.get('/:id/tracking', protect, canAccessOrder, getOrderTracking);

/**
 * =========================================================
 * DÉTAIL D'UNE COMMANDE
 * =========================================================
 *
 * GET /orders/:id
 */
router.get('/:id', protect, canAccessOrder, getOrderById);

/**
 * =========================================================
 * CRÉATION D'UNE COMMANDE
 * =========================================================
 *
 * POST /orders
 *
 * Accessible à :
 * - client
 * - admin
 */
router.post('/', protect, allowRoles('client', 'admin'), createOrder);

/**
 * =========================================================
 * MISE À JOUR DU STATUT D'UNE COMMANDE
 * =========================================================
 *
 * PUT /orders/:id/status
 *
 * Accessible via canAccessOrder selon rôle / ownership.
 */
router.put('/:id/status', protect, canAccessOrder, updateOrderStatus);

/**
 * =========================================================
 * ASSIGNATION D'UN LIVREUR
 * =========================================================
 *
 * PUT /orders/:id/assign-driver
 *
 * Accessible à :
 * - admin
 * - restaurant
 */
router.put(
  '/:id/assign-driver',
  protect,
  allowRoles('admin', 'restaurant'),
  canAccessOrder,
  assignDriverToOrder
);

/**
 * =========================================================
 * MISE À JOUR GPS LIVREUR SUR UNE COMMANDE
 * =========================================================
 *
 * PUT /orders/:id/driver-location
 *
 * Accessible au livreur assigné ou à l’admin.
 */
router.put(
  '/:id/driver-location',
  protect,
  allowRoles('admin', 'livreur'),
  canAccessOrder,
  updateDriverLocation
);

/**
 * =========================================================
 * SUPPRESSION D'UNE COMMANDE
 * =========================================================
 *
 * DELETE /orders/:id
 *
 * Accessible uniquement à l’admin.
 */
router.delete('/:id', protect, allowRoles('admin'), deleteOrder);

module.exports = router;