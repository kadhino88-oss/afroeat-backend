const express = require('express');

const router = express.Router();
const webhookRouter = express.Router();

const {
  getAvailablePaymentMethods,
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  selectCashPayment,
  handleWebhook,
  refundPayment,
} = require('../controllers/paymentController');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.get('/methods', protect, allowRoles('client', 'admin'), getAvailablePaymentMethods);
router.post('/select-cash', protect, allowRoles('client'), selectCashPayment);
// Alias retained for the current Expo source archive, whose endpoint is /payments/cash.
router.post('/cash', protect, allowRoles('client'), selectCashPayment);

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