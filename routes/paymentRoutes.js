const express = require('express');

const router = express.Router();
const webhookRouter = express.Router();

const {
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  selectCashPayment,
  getAvailablePaymentMethods,
  handleWebhook,
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
} = require('../controllers/connectController');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.get('/methods', protect, allowRoles('client', 'admin'), getAvailablePaymentMethods);

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

router.get('/connect/return', connectReturnPage);
router.get('/connect/refresh', refreshConnectOnboarding);
router.get('/connect/status', protect, allowRoles('restaurant', 'livreur'), getConnectStatus);
router.post('/connect/onboarding-link', protect, allowRoles('restaurant', 'livreur'), startConnectOnboarding);
router.post('/connect/dashboard-link', protect, allowRoles('restaurant', 'livreur'), createConnectDashboardLink);
router.post('/connect/reconcile/:orderId', protect, allowRoles('admin'), reconcileDeliveredOrderTransfers);
router.get('/connect/reconciliation', protect, allowRoles('admin'), listPayoutReconciliation);
router.post('/connect/reconciliation/:orderId/resolve', protect, allowRoles('admin'), resolvePayoutReconciliation);

router.post(
  '/refund',
  protect,
  allowRoles('admin'),
  refundPayment
);

webhookRouter.post('/', handleWebhook);

module.exports = {
  router,
  webhookRouter,
};