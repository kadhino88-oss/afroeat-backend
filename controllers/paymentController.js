const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const {
  isMatchingPaymentIntent,
  isMatchingCheckoutSession,
} = require('../utils/paymentValidation');
const { isFullyRefundedCharge } = require('../utils/refundGuards');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeString = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => Number(normalizeNumber(value, 0).toFixed(2));

const CURRENCY_CONFIG = {
  EUR: { multiplier: 100, minAmount: 0.5 },
  USD: { multiplier: 100, minAmount: 0.5 },
  GBP: { multiplier: 100, minAmount: 0.3 },
  CHF: { multiplier: 100, minAmount: 0.5 },
  CAD: { multiplier: 100, minAmount: 0.5 },
  XOF: { multiplier: 1, minAmount: 100 },
  XAF: { multiplier: 1, minAmount: 100 },
};

const toStripeAmount = (amount, currency) => {
  const config = CURRENCY_CONFIG[String(currency).toUpperCase()];
  return config ? Math.round(amount * config.multiplier) : null;
};

const getMinAmount = (currency) => {
  const config = CURRENCY_CONFIG[String(currency).toUpperCase()];
  return config ? config.minAmount : null;
};

const getAvailablePaymentMethods = (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  // This repository does not yet implement Stripe Connect onboarding and
  // payout reconciliation. Never enable live marketplace payments here.
  return res.status(200).json({
    success: true,
    methods: {
      card: !isProduction && stripeConfigured,
      cash: !isProduction && stripeConfigured,
    },
  });
};

const getOrderAmount = (order) => {
  return roundMoney(order?.totalPrice || 0);
};

const markOrderAsPaid = async ({
  orderId,
  paymentIntent = null,
  checkoutSession = null,
}) => {
  if (!orderId || !isValidObjectId(orderId)) return null;

  const order = await Order.findById(orderId);
  if (!order) return null;

  const validIntent = isMatchingPaymentIntent({
    order,
    paymentIntent,
    toStripeAmount,
  });
  const validSession = isMatchingCheckoutSession({
    order,
    checkoutSession,
    toStripeAmount,
  });

  // Only a Stripe object matching the stored ID, order, owner, amount,
  // currency and metadata can transition an order to paid.
  if (!validIntent && !validSession) return null;
  if (order.paymentStatus === 'Remboursé') return null;
  if (order.paymentStatus === 'Payé') return order;

  order.paymentStatus = 'Payé';
  order.paidAt = new Date();

  if (validIntent) order.paymentMethod = 'card';
  if (validSession) {
    order.paymentMethod = 'stripe_checkout';
    if (typeof checkoutSession.payment_intent === 'string') {
      order.stripePaymentIntentId = checkoutSession.payment_intent;
    }
  }

  if (order.status === 'En attente') order.status = 'Confirmée';

  await order.save();
  return order;
};

const getAuthorizedOrder = async (orderId, req) => {
  const order = await Order.findById(orderId)
    .populate('user', '_id name email stripeCustomerId')
    .populate('restaurant', '_id name');

  if (!order) {
    return { errorStatus: 404, errorMessage: 'Commande introuvable.' };
  }

  const isOwner = order.user?._id?.toString() === req.user._id.toString();

  if (!isOwner && req.user.role !== 'admin') {
    return { errorStatus: 403, errorMessage: 'Accès non autorisé à cette commande.' };
  }

  // This legacy repository does not include verified Stripe Connect payouts.
  // Fail closed for production rather than accept real marketplace payments.
  if (process.env.NODE_ENV === 'production') {
    return {
      errorStatus: 503,
      errorMessage: 'Les paiements marketplace sont indisponibles en production tant que Stripe Connect et les versements ne sont pas intégrés et vérifiés.',
    };
  }

  if (order.paymentStatus === 'Payé') {
    return { errorStatus: 409, errorMessage: 'Cette commande a déjà été payée.' };
  }

  if (order.status === 'Annulée') {
    return { errorStatus: 409, errorMessage: 'Impossible de payer une commande annulée.' };
  }

  return { order };
};

const ensureStripeCustomer = async (order) => {
  let stripeCustomerId = order.user?.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: order.user?.email || undefined,
      name: order.user?.name || undefined,
      metadata: {
        userId: order.user?._id?.toString() || '',
        platform: 'afroeat',
      },
    });

    stripeCustomerId = customer.id;
    await User.findByIdAndUpdate(order.user._id, { stripeCustomerId });
  }

  return stripeCustomerId;
};

const createPaymentIntent = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const { order, errorStatus, errorMessage } = await getAuthorizedOrder(orderId, req);

    if (!order) {
      return res.status(errorStatus).json({
        success: false,
        message: errorMessage,
      });
    }

    const currency = normalizeString(order.currency, 'EUR').toUpperCase();
    const amount = getOrderAmount(order);
    const minAmount = getMinAmount(currency);

    if (minAmount === null) {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_CURRENCY',
        message: `La devise ${currency} n’est pas prise en charge pour les paiements en ligne.`,
      });
    }

    if (amount < minAmount || !Number.isSafeInteger(toStripeAmount(amount, currency))) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PAYMENT_AMOUNT',
        message: `Le montant de la commande n’est pas valide pour ${currency}.`,
      });
    }

    const stripeCustomerId = await ensureStripeCustomer(order);

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toStripeAmount(amount, currency),
        currency: currency.toLowerCase(),
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        capture_method: 'automatic',
        description: `Commande AFROEAT #${order._id}`,
        receipt_email: order.user?.email || undefined,
        metadata: {
          orderId: order._id.toString(),
          userId: order.user?._id?.toString() || '',
          restaurantId: order.restaurant?._id?.toString() || '',
          restaurantName: order.restaurant?.name || '',
          platform: 'afroeat',
        },
      },
      {
        idempotencyKey: `payment_intent_${order._id}_${req.user._id}`,
      }
    );

    order.stripePaymentIntentId = paymentIntent.id;
    order.paymentMethod = 'card';
    await order.save();

    return res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount,
      currency: currency.toLowerCase(),
    });
  } catch (error) {
    console.error('CREATE PAYMENT INTENT ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,
      code: 'PAYMENT_INTENT_CREATION_FAILED',
      message: 'Impossible de préparer le paiement. Réessaie plus tard.',
    });
  }
};

const createCheckoutSession = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const { order, errorStatus, errorMessage } = await getAuthorizedOrder(orderId, req);

    if (!order) {
      return res.status(errorStatus).json({
        success: false,
        message: errorMessage,
      });
    }

    const currency = normalizeString(order.currency, 'EUR').toUpperCase();
    const amount = getOrderAmount(order);
    const minAmount = getMinAmount(currency);

    if (amount < minAmount) {
      return res.status(400).json({
        success: false,
        message: `Le montant minimum pour ${currency} est ${minAmount}.`,
      });
    }

    const stripeCustomerId = await ensureStripeCustomer(order);

    const appScheme = process.env.APP_DEEP_LINK_SCHEME || 'afroeat';
    const publicWebUrl = process.env.PUBLIC_WEB_URL || 'https://afroeat.app';

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        client_reference_id: order._id.toString(),
        success_url: `${appScheme}://payment/success?orderId=${order._id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appScheme}://payment/cancel?orderId=${order._id}`,
        metadata: {
          orderId: order._id.toString(),
          userId: order.user?._id?.toString() || '',
          restaurantId: order.restaurant?._id?.toString() || '',
          platform: 'afroeat',
        },
        payment_intent_data: {
          metadata: {
            orderId: order._id.toString(),
            userId: order.user?._id?.toString() || '',
            restaurantId: order.restaurant?._id?.toString() || '',
            platform: 'afroeat',
          },
          receipt_email: order.user?.email || undefined,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: toStripeAmount(amount, currency),
              product_data: {
                name: `Commande AFROEAT #${order._id}`,
                description: order.restaurant?.name
                  ? `Restaurant : ${order.restaurant.name}`
                  : 'Commande AFROEAT',
              },
            },
          },
        ],
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        idempotencyKey: `checkout_session_${order._id}_${req.user._id}`,
      }
    );

    order.stripeCheckoutSessionId = session.id;
    order.paymentMethod = 'stripe_checkout';
    await order.save();

    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id,
      amount,
      currency: currency.toLowerCase(),
      fallbackSuccessUrl: `${publicWebUrl}/payment/success?orderId=${order._id}`,
    });
  } catch (error) {
    console.error('CREATE CHECKOUT SESSION ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,
      code: 'CHECKOUT_SESSION_CREATION_FAILED',
      message: 'Impossible de préparer le paiement. Réessaie plus tard.',
    });
  }
};

const confirmPayment = async (req, res) => {
  try {
    const { orderId, paymentIntentId, checkoutSessionId } = req.body;

    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    const isOwner = order.user?.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette commande.',
      });
    }

    if (checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);

      if (session.payment_status !== 'paid') {
        return res.status(402).json({
          success: false,
          message: `Paiement non finalisé. Statut : ${session.payment_status}`,
        });
      }

      const paidOrder = await markOrderAsPaid({ orderId, checkoutSession: session });

      if (!paidOrder) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_VALIDATION_FAILED',
          message: 'Le paiement ne correspond pas à cette commande. Contacte le support si le débit a bien été effectué.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Paiement confirmé.',
        orderId: paidOrder._id,
        paymentStatus: paidOrder.paymentStatus,
      });
    }

    if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status !== 'succeeded') {
        return res.status(402).json({
          success: false,
          message: `Paiement non finalisé. Statut : ${paymentIntent.status}`,
        });
      }

      const paidOrder = await markOrderAsPaid({ orderId, paymentIntent });

      if (!paidOrder) {
        return res.status(409).json({
          success: false,
          code: 'PAYMENT_VALIDATION_FAILED',
          message: 'Le paiement ne correspond pas à cette commande. Contacte le support si le débit a bien été effectué.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Paiement confirmé.',
        orderId: paidOrder._id,
        paymentStatus: paidOrder.paymentStatus,
      });
    }

    return res.status(400).json({
      success: false,
      message: 'paymentIntentId ou checkoutSessionId obligatoire.',
    });
  } catch (error) {
    console.error('CONFIRM PAYMENT ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,
      code: 'PAYMENT_CONFIRMATION_FAILED',
      message: 'Impossible de confirmer le paiement. Réessaie plus tard.',
    });
  }
};

const handleWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Webhook mal configuré.',
    });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch (error) {
    console.error('WEBHOOK SIGNATURE ERROR =>', error.message);

    return res.status(400).json({
      success: false,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      message: 'Signature webhook Stripe invalide.',
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId || session.client_reference_id;

        if (orderId && isValidObjectId(orderId) && session.payment_status === 'paid') {
          const paidOrder = await markOrderAsPaid({ orderId, checkoutSession: session });

          if (paidOrder) {
            console.log(`Checkout payé webhook : commande ${orderId}`);
          } else {
            console.error(`Webhook Checkout ignoré : validation commande impossible (${orderId}, ${session.id}).`);
          }
        }

        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId && isValidObjectId(orderId)) {
          const paidOrder = await markOrderAsPaid({ orderId, paymentIntent });

          if (paidOrder) {
            console.log(`PaymentIntent payé webhook : commande ${orderId}`);
          } else {
            console.error(`Webhook PaymentIntent ignoré : validation commande impossible (${orderId}, ${paymentIntent.id}).`);
          }
        }

        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId && isValidObjectId(orderId)) {
          await Order.findOneAndUpdate(
            {
              _id: orderId,
              stripePaymentIntentId: paymentIntent.id,
              paymentStatus: { $ne: 'Payé' },
            },
            {
              paymentStatus: 'Non payé',
              lastPaymentError:
                paymentIntent.last_payment_error?.message || 'Paiement échoué',
            }
          );

          console.log(`❌ Paiement échoué webhook: commande ${orderId}`);
        }

        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const orderId = session.metadata?.orderId || session.client_reference_id;

        if (orderId && isValidObjectId(orderId)) {
          await Order.findOneAndUpdate(
            {
              _id: orderId,
              stripeCheckoutSessionId: session.id,
              paymentStatus: { $ne: 'Payé' },
            },
            {
              paymentStatus: 'Non payé',
              lastPaymentError: 'Session Stripe Checkout expirée',
            }
          );
        }

        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        if (paymentIntentId && isFullyRefundedCharge(charge)) {
          const order = await Order.findOne({
            stripePaymentIntentId: paymentIntentId,
            paymentStatus: { $ne: 'Remboursé' },
          });

          if (order) {
            order.paymentStatus = 'Remboursé';
            order.refundedAt = new Date();
            await order.save();
            console.log(`Remboursement intégral confirmé : commande ${order._id}`);
          }
        } else if (paymentIntentId) {
          console.log('Remboursement partiel : la commande reste dans son état de paiement courant.');
        }

        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        console.warn('⚠️ Dispute Stripe créée:', {
          disputeId: dispute.id,
          reason: dispute.reason,
        });
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error('WEBHOOK PROCESSING ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      received: false,
      code: 'WEBHOOK_PROCESSING_FAILED',
    });
  }

  return res.status(200).json({ received: true });
};

const selectCashPayment = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({
      success: false,
      code: 'CASH_ON_DELIVERY_DISABLED',
      message: 'Le paiement à la livraison est désactivé en production tant que le registre de collecte et de règlement n’est pas disponible.',
    });
  }

  try {
    const { orderId } = req.body || {};
    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({ success: false, message: 'ID commande invalide.' });
    }

    const { order, errorStatus, errorMessage } = await getAuthorizedOrder(orderId, req);
    if (!order) {
      return res.status(errorStatus).json({ success: false, message: errorMessage });
    }

    if (order.paymentStatus === 'Remboursé' || order.paymentStatus === 'Payé') {
      return res.status(409).json({
        success: false,
        code: 'PAYMENT_ALREADY_SETTLED',
        message: 'Cette commande ne peut plus changer de mode de paiement.',
      });
    }

    if (order.stripePaymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
      if (intent.status === 'succeeded') {
        const paidOrder = await markOrderAsPaid({ orderId, paymentIntent: intent });
        return res.status(409).json({
          success: false,
          code: 'CARD_PAYMENT_ALREADY_COMPLETED',
          message: paidOrder
            ? 'Un paiement par carte a déjà été effectué pour cette commande.'
            : 'Le paiement doit être vérifié par le support avant de changer de mode.',
        });
      }
      if (intent.status !== 'canceled') {
        try {
          await stripe.paymentIntents.cancel(intent.id);
        } catch {
          return res.status(409).json({
            success: false,
            message: 'Le paiement par carte est en cours. Réessaie dans quelques instants.',
          });
        }
      }
    }

    if (order.stripeCheckoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
      if (session.payment_status === 'paid') {
        const paidOrder = await markOrderAsPaid({ orderId, checkoutSession: session });
        return res.status(409).json({
          success: false,
          code: 'CARD_PAYMENT_ALREADY_COMPLETED',
          message: paidOrder
            ? 'Un paiement par carte a déjà été effectué pour cette commande.'
            : 'Le paiement doit être vérifié par le support avant de changer de mode.',
        });
      }
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      order.stripeCheckoutSessionId = null;
    }

    order.paymentMethod = 'cash';
    order.stripePaymentIntentId = null;
    order.lastPaymentError = '';
    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Paiement à la livraison sélectionné.',
      orderId: order._id,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    });
  } catch (error) {
    console.error('SELECT CASH PAYMENT ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      code: 'CASH_PAYMENT_SELECTION_FAILED',
      message: 'Impossible de sélectionner le paiement à la livraison. Réessaie plus tard.',
    });
  }
};

const refundPayment = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin uniquement.',
      });
    }

    const { orderId, reason } = req.body;

    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    if (!order.stripePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Aucun paiement Stripe associé à cette commande.',
      });
    }

    if (order.paymentStatus === 'Remboursé') {
      return res.status(409).json({
        success: false,
        message: 'Cette commande a déjà été remboursée.',
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      reason: reason || 'requested_by_customer',
    });

    order.paymentStatus = 'Remboursé';
    order.refundedAt = new Date();
    order.stripeRefundId = refund.id;
    await order.save();

    return res.status(200).json({
      success: true,
      message: 'Remboursement effectué avec succès.',
      refundId: refund.id,
      orderId: order._id,
    });
  } catch (error) {
    console.error('REFUND ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,
      message: error?.message || 'Erreur remboursement.',
    });
  }
};

module.exports = {
  getAvailablePaymentMethods,
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  selectCashPayment,
  handleWebhook,
  refundPayment,
};