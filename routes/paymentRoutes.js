const express = require('express');

const router = express.Router();
const webhookRouter = express.Router();

const {
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  handleWebhook,
  refundPayment,
} = require('../controllers/paymentController');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

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