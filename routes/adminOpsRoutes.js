const express = require('express');

const router = express.Router();

const { protect } = require('../controllers/userController');
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

module.exports = router;