'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const {
  getMyVerification,
  uploadMyDocument,
  deleteMyDocument,
} = require('../controllers/verificationController');

const router = express.Router();

// Quelques envois par heure suffisent : une pièce d'identité ne se renvoie pas en boucle.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 12 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop d’envois. Réessaie plus tard.' },
});

router.use(protect, allowRoles('livreur', 'restaurant'));
router.get('/me', getMyVerification);
router.post('/documents', uploadLimiter, uploadMyDocument);
router.delete('/documents/:id', deleteMyDocument);

module.exports = router;
