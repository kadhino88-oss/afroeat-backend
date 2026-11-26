const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const webhookRouter = express.Router();

// Limiteurs déclarés sur la route elle-même (en plus de celui de /api/payments dans server.js) : l'analyse
// de code ne voit pas un limiteur monté ailleurs. Réponse 429 : Stripe réessaie ses webhooks.
const connectWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes.' },
});
const cronLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes.' },
});

const { reconcileDailyCron } = require('../controllers/ledgerController');

const {
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  selectCashPayment,
  getAvailablePaymentMethods,
  handleWebhook,
  handleConnectWebhook,
  refundPayment,
} = require('../controllers/paymentController');

const {
  getConnectStatus,
  startConnectOnboarding,
  createConnectDashboardLink,
  refreshConnectOnboarding,
  connectReturnPage,
  reconcileDeliveredOrderTransfers,
  listPayoutReconciliation,
  resolvePayoutReconciliation,
  retryPayoutsCron,
} = require('../controllers/connectController');

const {
  listSavedCards,
  createCardSetupIntent,
  createCardSetupSession,
  setDefaultSavedCard,
  removeSavedCard,
} = require('../controllers/savedCardController');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.get('/methods', protect, allowRoles('client', 'admin'), getAvailablePaymentMethods);

// Cartes enregistrées du client (ajout par SetupIntent, jamais de numéro de carte ici).
router.get('/cards', protect, allowRoles('client'), listSavedCards);
router.post('/cards/setup-intent', protect, allowRoles('client'), createCardSetupIntent);
router.post('/cards/setup-session', protect, allowRoles('client'), createCardSetupSession);
router.patch('/cards/:paymentMethodId/default', protect, allowRoles('client'), setDefaultSavedCard);
router.delete('/cards/:paymentMethodId', protect, allowRoles('client'), removeSavedCard);

router.post(
  '/create-payment-intent',
  protect,
  allowRoles('client', 'admin'),
  createPaymentIntent
);

router.post(
  '/checkout',
  protect,
  allowRoles('client', 'admin'),
  createCheckoutSession
);

router.post(
  '/confirm',
  protect,
  allowRoles('client', 'admin'),
  confirmPayment
);

router.post(
  '/select-cash',
  protect,
  allowRoles('client', 'admin'),
  selectCashPayment
);

// Backward-compatible alias used by the authoritative AfroeatApp source.
router.post('/cash', protect, allowRoles('client'), selectCashPayment);

router.get('/connect/return', connectReturnPage);
router.get('/connect/refresh', refreshConnectOnboarding);
router.get('/connect/status', protect, allowRoles('restaurant', 'livreur'), getConnectStatus);
router.post('/connect/onboarding-link', protect, allowRoles('restaurant', 'livreur'), startConnectOnboarding);
router.post('/connect/dashboard-link', protect, allowRoles('restaurant', 'livreur'), createConnectDashboardLink);
router.post('/connect/reconcile/:orderId', protect, allowRoles('admin'), reconcileDeliveredOrderTransfers);
router.get('/connect/reconciliation', protect, allowRoles('admin'), listPayoutReconciliation);
router.post('/connect/reconciliation/:orderId/resolve', protect, allowRoles('admin'), resolvePayoutReconciliation);

// Relance par lot des versements en attente : appelée par un cron avec `Authorization: Bearer <CRON_SECRET>`
// (pas de session). Passe par le même limiteur « paiement » que le reste de /api/payments.
router.post('/connect/retry-payouts', cronLimiter, retryPayoutsCron);

// Rapprochement quotidien du ledger avec Stripe (veille, UTC) : cron avec `Authorization: Bearer <CRON_SECRET>`.
// Lecture seule côté argent : stocke un rapport et ne renvoie que des compteurs, ne corrige jamais rien.
router.post('/ledger/reconcile-daily', cronLimiter, reconcileDailyCron);

router.post(
  '/refund',
  protect,
  allowRoles('admin'),
  refundPayment
);

webhookRouter.post('/', handleWebhook);
// Événements des comptes connectés : secret de signature distinct (STRIPE_CONNECT_WEBHOOK_SECRET).
webhookRouter.post('/connect', connectWebhookLimiter, handleConnectWebhook);

module.exports = {
  router,
  webhookRouter,
};
