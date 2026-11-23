const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { requireAdminOrigin } = require('../utils/adminOrigin');
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

const {
  listApplications,
  updateApplication,
  createInvite,
} = require('../controllers/partnerApplicationController');

const {
  listDocuments: listVerificationDocuments,
  getDocumentFile: getVerificationDocumentFile,
  reviewDocument: reviewVerificationDocument,
} = require('../controllers/verificationController');
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
// En production, l'API d'administration ne répond qu'à l'adresse dédiée à l'administration.
router.use(requireAdminOrigin);

// Codes promo (remises financées par la plateforme).
const promos = require('../controllers/promoController');
router.get('/promo-codes', promos.listPromos);
router.post('/promo-codes', promos.createPromo);
router.patch('/promo-codes/:id', promos.setPromoActive);

// Surveillance des erreurs (API et site).
const monitoring = require('../controllers/monitoringController');
router.get('/errors', monitoring.listErrors);
router.patch('/errors/:id/resolve', monitoring.resolveError);

// Double authentification de l'administrateur connecté.
const twoFactor = require('../controllers/twoFactorController');
router.get('/2fa/status', twoFactor.status);
router.post('/2fa/setup', twoFactor.setup);
router.post('/2fa/enable', twoFactor.enable);
router.post('/2fa/disable', twoFactor.disable);

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
 * Demandes d'inscription de commerces
 */
router.get('/partner-applications', listApplications);
router.put('/partner-applications/:id', updateApplication);
router.post('/partner-applications/:id/invite', createInvite);

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
 * Registre des commissions dues sur les commandes payées en espèces
 */
router.get('/cash-ledger', require('../controllers/cashLedgerController').listCashLedger);
router.post('/cash-ledger/:kind/:id/settle', require('../controllers/cashLedgerController').settleCashLedger);

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
// Pièces justificatives des partenaires (fichiers chiffrés, consultations tracées).
router.get('/verification', listVerificationDocuments);
router.get('/verification/:id/file', getVerificationDocumentFile);
router.patch('/verification/:id', reviewVerificationDocument);

router.use('/audit-logs', adminAuditRoutes);
router.patch('/reviews/:id', require('../controllers/reviewController').setReviewHidden);
router.use('/ops', adminOpsRoutes);

module.exports = router;