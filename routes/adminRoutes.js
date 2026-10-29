const express = require('express');

const router = express.Router();

const { protect } = require('../controllers/userController');
const {
  getAdminDashboard,
  getAdminUsers,
  getAdminUserById,
  updateAdminUserStatus,
  updateAdminUserVerification,
  getAdminRestaurants,
  getAdminRestaurantById,
  getAdminDrivers,
  getAdminOrders,
  getAdminOrderById,
} = require('../controllers/adminController');

const adminAuditRoutes = require('./adminAuditRoutes');
const adminOpsRoutes = require('./adminOpsRoutes');

/**
 * =========================================================
 * ADMIN ROUTES
 * =========================================================
 * Objectif :
 * - garder la structure actuelle
 * - renforcer la protection d’accès
 * - éviter tout accès non-admin avant même le contrôleur
 * - conserver les sous-routes audit / ops propres et protégées
 * =========================================================
 */

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentification requise.',
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Accès refusé.',
    });
  }

  return next();
};

/**
 * Protection globale du bloc admin
 * ---------------------------------------------------------
 * Double sécurité :
 * 1. protect vérifie l’authentification
 * 2. requireAdmin verrouille le rôle admin
 *
 * Même si les contrôleurs revérifient déjà le rôle,
 * on bloque ici le plus tôt possible.
 */
router.use(protect);
router.use(requireAdmin);

/**
 * Dashboard
 */
router.get('/dashboard', getAdminDashboard);

/**
 * Users
 */
router.get('/users', getAdminUsers);
router.get('/users/:id', getAdminUserById);
router.put('/users/:id/status', updateAdminUserStatus);
router.put('/users/:id/verification', updateAdminUserVerification);

/**
 * Restaurants
 */
router.get('/restaurants', getAdminRestaurants);
router.get('/restaurants/:id', getAdminRestaurantById);

/**
 * Drivers
 */
router.get('/drivers', getAdminDrivers);

/**
 * Orders
 */
router.get('/orders', getAdminOrders);
router.get('/orders/:id', getAdminOrderById);

/**
 * Sous-routes admin secondaires
 * ---------------------------------------------------------
 * Elles héritent déjà de protect + requireAdmin grâce
 * au router.use global ci-dessus.
 */
router.use('/audit-logs', adminAuditRoutes);
router.use('/ops', adminOpsRoutes);

module.exports = router;