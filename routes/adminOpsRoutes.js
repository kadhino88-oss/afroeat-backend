const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { getAdminOpsOverview } = require('../controllers/adminOpsController');

/**
 * =========================================================
 * ADMIN OPS ROUTES
 * =========================================================
 * Objectif :
 * - exposer les métriques et l’état opérationnel admin
 * - renforcer la sécurité au niveau route
 * - garder la compatibilité avec le contrôleur existant
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
 * Double protection :
 * - protect : utilisateur authentifié
 * - requireAdmin : rôle admin obligatoire
 */
router.use(protect);
router.use(requireAdmin);

/**
 * =========================================================
 * OPS OVERVIEW
 * =========================================================
 * GET /admin/ops
 */
router.get('/', getAdminOpsOverview);

// Relance manuelle de l'annulation des commandes sans suite (et des remboursements associés).
router.post('/expire-stale-orders', async (req, res) => {
  try {
    const Order = require('../models/Order');
    const { expireStaleOrders } = require('../utils/staleOrders');
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
    const { reconcileRefunds } = require('../utils/orderRefund');
    const result = await expireStaleOrders({ Order, stripe });
    const refundsReconciled = await reconcileRefunds({ Order, stripe });
    return res.json({ success: true, ...result, refundsReconciled });
  } catch (error) {
    console.error('expire-stale-orders:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;