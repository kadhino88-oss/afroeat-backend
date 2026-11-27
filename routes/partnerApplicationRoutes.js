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

// Conditions commerciales publiques (commission par devise), lues depuis MARKETPLACE_RATES_JSON.
router.get('/terms', (req, res) => {
  const { loadMarketplaceRates } = require('../config/marketplaceRates');
  const { partnerTermsFromRates } = require('../utils/partnerTerms');
  let rates = {};
  try {
    rates = loadMarketplaceRates();
  } catch {
    rates = {};
  }
  res.set('Cache-Control', 'public, max-age=300');
  const { offerSummary } = require('../utils/partnerOffer');
  const { isConnectPayoutsEnabled } = require('../utils/marketplacePayouts');
  // payoutsAutomatic : faux tant que les versements Stripe Connect sont coupés — l'appli n'affiche alors pas
  // la promesse « versé automatiquement à chaque commande livrée ».
  return res.json({
    success: true,
    terms: { ...partnerTermsFromRates(rates), offer: { ...offerSummary(), payoutsAutomatic: isConnectPayoutsEnabled() } },
  });
});

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
