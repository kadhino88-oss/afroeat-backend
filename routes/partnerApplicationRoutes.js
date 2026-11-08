const express = require('express');
const rateLimit = require('express-rate-limit');
const { createApplication } = require('../controllers/partnerApplicationController');

const router = express.Router();

// Route publique : quelques demandes par heure et par adresse IP suffisent.
const applicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de demandes. Réessaie plus tard.' },
});

router.post('/', applicationLimiter, createApplication);

module.exports = router;
