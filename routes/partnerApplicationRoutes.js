const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  createApplication,
  getInvite,
  registerFromInvite,
} = require('../controllers/partnerApplicationController');

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

// Invitation : le partenaire crée lui-même son compte (jeton de 64 caractères, à usage unique).
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessaie plus tard.' },
});

router.get('/invite/:token', inviteLimiter, getInvite);
router.post('/invite/:token/register', inviteLimiter, registerFromInvite);

module.exports = router;
