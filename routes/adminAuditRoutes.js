const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');

const {
  getAuditLogs,
  getAuditLogById,
} = require('../controllers/adminAuditController');

/**
 * =========================================================
 * ADMIN AUDIT ROUTES — VERSION FINALE ROBUSTE
 * =========================================================
 * Objectif :
 * - routes dédiées aux logs admin
 * - sécurité strictement centralisée
 * - cohérence totale avec le backend AFROEAT
 * - zéro middleware bricolé dans la route
 * =========================================================
 */

router.use(protect);
router.use(adminOnly);

/**
 * =========================================================
 * AUDIT LOGS
 * =========================================================
 */

// Liste des logs (filtres, pagination, recherche, tri)
router.get('/', getAuditLogs);

// Détail d’un log
router.get('/:id', getAuditLogById);

module.exports = router;