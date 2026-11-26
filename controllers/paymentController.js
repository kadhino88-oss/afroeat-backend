const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const {
  isMatchingPaymentIntent,
  isMatchingCheckoutSession,
} = require('../utils/paymentValidation');
const { isFullyRefundedCharge } = require('../utils/refundGuards');
const { toMinorUnits, fromMinorUnits, getMinAmount } = require('../utils/currency');
const { refundCancelledOrder, applyRefundResult } = require('../utils/orderRefund');
const StripeEvent = require('../models/StripeEvent');
const { claimEvent, completeEvent, releaseEvent } = require('../utils/stripeEventLog');
const {
  reverseOrderTransfers,
  flagOrderDispute,
  handleLostDisputePayout,
  reconcileOrderPayout,
} = require('../utils/marketplacePayouts');
const { handleConnectedAccountUpdated } = require('./connectController');
const { evaluatePaymentChannel } = require('../utils/paymentChannel');
const { getOrderPaymentCreationBlock } = require('../utils/orderPaymentGuard');
const {
  isProductionLocked,
  isRealProduction,
  isLiveCommerceOpen,
} = require('../utils/runtimeEnvironment');
const { resolveReturnBase } = require('./savedCardController');

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

const toStripeAmount = toMinorUnits;

const hasStripeTestSecret = () =>
  /^(sk|rk)_test_/.test(String(process.env.STRIPE_SECRET_KEY || ''));

// Carte : clé de TEST hors production réelle, ou clé réelle une fois le commerce ouvert.
const canCreateCardPayment = () =>
  !isProductionLocked() && Boolean(stripe) && (hasStripeTestSecret() || isLiveCommerceOpen());

const { isCashAllowedForOrder, cashDecision } = require('../utils/cashPayment');

const stripeUnavailable = (res) =>
  res.status(503).json({
    success: false,
    code: 'STRIPE_NOT_CONFIGURED',
    message: 'Les paiements par carte sont temporairement indisponibles.',
  });

const stripeTestKeyRequired = (res) =>
  res.status(503).json({
    success: false,
    code: 'STRIPE_TEST_KEY_REQUIRED',
    message: 'Une clé Stripe de test est requise pour les paiements en environnement de développement.',
  });

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

  // Only mark paid when a successful Stripe object matches the order's
  // stored ID, owner, amount, currency and metadata. Never let a stale
  // webhook reopen a fully refunded order.
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

  if (!validIntent && !validSession) return null;
  if (order.paymentStatus === 'Remboursé') return null;
  if (order.paymentStatus === 'Payé') return order;

  const paidAt = new Date();
  const set = { paymentStatus: 'Payé', paidAt };
  if (validIntent) set.paymentMethod = 'card';
  if (validSession) {
    set.paymentMethod = 'stripe_checkout';
    if (typeof checkoutSession.payment_intent === 'string') {
      set.stripePaymentIntentId = checkoutSession.payment_intent;
    }
  }

  // Prise de verrou atomique : seule l'exécution qui fait passer la commande à « Payé »
  // l'annonce (webhook et /confirm peuvent arriver en même temps).
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $nin: ['Payé', 'Remboursé'] } },
    { $set: set },
    { new: true }
  );

  if (!claimed) {
    // Une autre exécution a gagné : réponse idempotente, sans nouvelle annonce.
    const current = await Order.findById(orderId);
    return current && current.paymentStatus === 'Payé' ? current : null;
  }

  // Paiement arrivé après l'annulation : jamais de remise en « Confirmée », remboursement automatique.
  if (claimed.status === 'Annulée') {
    console.warn(`PAIEMENT TARDIF sur commande annulée ${claimed._id} : remboursement automatique.`);
    const refund = await refundCancelledOrder(claimed, stripe);
    if (!refund.refunded) {
      console.error(`REMBOURSEMENT TARDIF NON EFFECTUÉ (${claimed._id}) : ${refund.reason}. Rapprochement manuel requis.`);
    }
    return claimed;
  }

  let announced = claimed;
  if (claimed.status === 'En attente') {
    // Transition conditionnelle : une annulation survenue entre-temps n'est pas écrasée.
    const confirmed = await Order.findOneAndUpdate(
      { _id: claimed._id, status: 'En attente' },
      {
        $set: { status: 'Confirmée' },
        $push: { statusHistory: { status: 'Confirmée', updatedBy: null, updatedByRole: '', note: '', at: new Date() } },
      },
      { new: true }
    );
    if (confirmed) {
      announced = confirmed;
    } else {
      const latest = await Order.findById(claimed._id);
      if (latest?.status === 'Annulée') {
        console.warn(`PAIEMENT TARDIF sur commande annulée ${latest._id} : remboursement automatique.`);
        await refundCancelledOrder(latest, stripe);
        return latest;
      }
      announced = latest || claimed;
    }
  }

  // Nouvelle commande payée : alerte du restaurant et des livreurs proches (erreurs journalisées, jamais bloquantes).
  await require('../utils/courierDispatch').announcePaidOrder(announced).catch(() => {});
  return announced;
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

  const paymentBlock = getOrderPaymentCreationBlock(order);
  if (paymentBlock) return paymentBlock;

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
    if (!stripe) return stripeUnavailable(res);

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

    const channelDecision = evaluatePaymentChannel(order, 'card');
    if (!channelDecision.allowed) {
      return res.status(409).json({
        success: false,
        code: channelDecision.code,
        message: channelDecision.message,
      });
    }

    // Stripe Connect onboarding, marketplace split calculation and payout
    // reconciliation are implemented, but the complete settlement path has not
    // yet passed end-to-end verification with Stripe and MongoDB. Keep production
    // card payments fail-closed until staging verification covers payment, delivery,
    // payout, refund, dispute and reconciliation paths. Unit tests alone are not
    // sufficient to remove this safeguard.
    if (isProductionLocked()) {
      return res.status(503).json({
        success: false,
        code: 'MARKETPLACE_PAYMENTS_NOT_READY',
        message: 'Les paiements marketplace attendent la configuration et la validation des versements AFROEAT.',
      });
    }

    if (!canCreateCardPayment()) return stripeTestKeyRequired(res);

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
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
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
    if (!stripe) return stripeUnavailable(res);

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

    const channelDecision = evaluatePaymentChannel(order, 'stripe_checkout');
    if (!channelDecision.allowed) {
      return res.status(409).json({
        success: false,
        code: channelDecision.code,
        message: channelDecision.message,
      });
    }

    if (isProductionLocked()) {
      return res.status(503).json({
        success: false,
        code: 'MARKETPLACE_PAYMENTS_NOT_READY',
        message: 'Les paiements marketplace attendent la configuration et la validation des versements AFROEAT.',
      });
    }

    if (!canCreateCardPayment()) return stripeUnavailable(res);

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

    // Web : retour https vers une origine déjà autorisée (anti open-redirect).
    // Mobile : lien profond de l'appli (Stripe n'accepte pas toujours un schéma personnalisé,
    // mais c'est le comportement historique du mobile).
    const appScheme = process.env.APP_DEEP_LINK_SCHEME || 'afroeat';
    const publicWebUrl = process.env.PUBLIC_WEB_URL || 'https://afroeat.app';
    const webBase = req.body?.platform === 'web' ? resolveReturnBase(req.body?.returnUrl) : null;
    const returnBase = webBase || `${appScheme}:/`;

    // Nouvelle tentative (le client est revenu de Stripe sans payer) : on réutilise la page
    // de paiement encore ouverte au lieu d'en recréer une.
    if (order.stripeCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
        if (existing?.status === 'complete' && existing?.payment_status === 'paid') {
          return res.status(409).json({
            success: false,
            code: 'ORDER_ALREADY_PAID',
            message: 'Cette commande est déjà payée.',
          });
        }
        if (existing?.status === 'open' && existing?.url) {
          return res.status(200).json({
            success: true,
            url: existing.url,
            sessionId: existing.id,
            amount,
            currency: currency.toLowerCase(),
            fallbackSuccessUrl: `${publicWebUrl}/payment/success?orderId=${order._id}`,
          });
        }
      } catch (lookupError) {
        console.error('CHECKOUT SESSION LOOKUP ERROR =>', lookupError?.message);
      }
    }

    // La clé d'idempotence doit correspondre à des paramètres identiques : l'échéance est donc
    // arrondie à la minute et la clé change à chaque minute et à chaque nouvelle tentative.
    const minuteBucket = Math.floor(Date.now() / 60000);
    const attemptTag = order.stripeCheckoutSessionId
      ? order.stripeCheckoutSessionId.slice(-12)
      : 'first';
    const platformTag = webBase ? 'web' : 'app';

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: stripeCustomerId,
        // Pas de payment_method_types : Stripe le refuse pour Checkout (moyens de paiement
        // gérés depuis le tableau de bord Stripe, « card » activé par défaut).
        client_reference_id: order._id.toString(),
        success_url: `${returnBase}/payment/success?orderId=${order._id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnBase}/payment/cancel?orderId=${order._id}`,
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
        expires_at: minuteBucket * 60 + 31 * 60,
      },
      {
        idempotencyKey: `checkout_session_${order._id}_${req.user._id}_${platformTag}_${attemptTag}_${minuteBucket}`,
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
    if (!stripe) return stripeUnavailable(res);

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

  // Idempotence : un événement déjà reçu (même event.id) est acquitté sans rejouer ses effets.
  let claimedEvent = false;
  if (event?.id) {
    try {
      if ((await claimEvent(StripeEvent, event)) === 'duplicate') {
        return res.status(200).json({ received: true, duplicate: true });
      }
      claimedEvent = true;
    } catch (error) {
      console.error('WEBHOOK EVENT LOG ERROR =>', error?.message);
      return res.status(500).json({ received: false, code: 'WEBHOOK_PROCESSING_FAILED' });
    }
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
              paymentStatus: { $nin: ['Payé', 'Remboursé'] },
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

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object;
        const orderId = paymentIntent.metadata?.orderId;

        if (orderId && isValidObjectId(orderId)) {
          // Jamais de rétrogradation d'une commande déjà payée ou remboursée.
          await Order.findOneAndUpdate(
            {
              _id: orderId,
              stripePaymentIntentId: paymentIntent.id,
              paymentStatus: { $nin: ['Payé', 'Remboursé'] },
            },
            {
              paymentStatus: 'Non payé',
              lastPaymentError: `Paiement Stripe annulé${paymentIntent.cancellation_reason ? ` (${paymentIntent.cancellation_reason})` : ''}`.slice(0, 300),
            }
          );
        }

        break;
      }

      case 'refund.updated':
      case 'refund.failed': {
        const refund = event.data.object;
        const paymentIntentId = typeof refund.payment_intent === 'string'
          ? refund.payment_intent
          : refund.payment_intent?.id;

        if (paymentIntentId) {
          const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
          if (order) {
            if (refund.status === 'failed' || refund.status === 'canceled' || event.type === 'refund.failed') {
              // Remboursement en échec : conservé pour réconciliation (administration), jamais « Remboursé ».
              if (order.paymentStatus !== 'Remboursé') {
                order.stripeRefundId = refund.id || order.stripeRefundId;
                order.refundError = `Remboursement Stripe en échec (${refund.failure_reason || refund.status || 'failed'}) : rapprochement requis.`.slice(0, 300);
                await order.save();
                console.error(`REMBOURSEMENT STRIPE EN ÉCHEC : commande ${order._id}, refund ${refund.id}.`);
              }
            } else if (refund.status === 'succeeded' && order.paymentStatus === 'Payé') {
              applyRefundResult(order, refund);
              await order.save();
            }
          }
        }

        break;
      }

      case 'charge.dispute.updated': {
        const dispute = event.data.object;
        const paymentIntentId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
        // Un litige déjà clos est traité par charge.dispute.closed : une mise à jour tardive ne le rouvre pas.
        const isClosed = ['won', 'lost', 'warning_closed'].includes(dispute.status);
        if (paymentIntentId && !isClosed) {
          await flagOrderDispute(paymentIntentId, dispute.id);
        }
        console.warn('Litige Stripe mis à jour :', { disputeId: dispute.id, status: dispute.status });
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
              paymentStatus: { $nin: ['Payé', 'Remboursé'] },
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
        const paymentIntentId = typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id;

        if (paymentIntentId) {
          const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
          if (order) {
            const fullyRefunded = isFullyRefundedCharge(charge);
            const refundCurrency = String(charge.currency || order.currency || 'EUR').toUpperCase();
            order.stripeAmountRefunded = fromMinorUnits(charge.amount_refunded || 0, refundCurrency) ?? 0;
            if (fullyRefunded) {
              order.paymentStatus = 'Remboursé';
              order.refundedAt = new Date();
            } else {
              order.lastPaymentError = 'Remboursement partiel Stripe reçu : rapprochement financier requis.';
            }
            await order.save();

            // Full refunds reverse existing Connect transfers idempotently.
            // Partial refunds are flagged for review and cannot trigger payouts.
            await reverseOrderTransfers(order, charge);
            console.log(
              `Remboursement ${fullyRefunded ? 'intégral' : 'partiel'} webhook : commande ${order._id}`
            );
          }
        }

        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const paymentIntentId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
        if (paymentIntentId) {
          await flagOrderDispute(paymentIntentId, dispute.id);
        }
        console.warn('Litige Stripe créé :', { disputeId: dispute.id, reason: dispute.reason });
        break;
      }

      case 'charge.dispute.closed': {
        const dispute = event.data.object;
        const paymentIntentId = typeof dispute.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute.payment_intent?.id;

        if (paymentIntentId) {
          const order = await Order.findOne({ stripePaymentIntentId: paymentIntentId });
          if (order) {
            order.stripeDisputeClosedAt = new Date();
            if (dispute.status === 'won') {
              order.stripeDisputeId = null;
              order.payoutStatus = order.payoutStatus === 'transferred' ? 'transferred' : 'pending';
              order.payoutError = '';
              await order.save();
              await reconcileOrderPayout(order._id);
            } else if (dispute.status === 'lost') {
              // Litige perdu : réversion des transferts Connect déjà faits, ou annulation du versement.
              order.stripeDisputeLostAt = order.stripeDisputeLostAt || new Date();
              await order.save();
              await handleLostDisputePayout(order);
              console.warn('Litige Stripe perdu traité :', { orderId: String(order._id), disputeId: dispute.id });
            } else {
              order.payoutStatus = 'reconciliation_required';
              order.payoutError = 'Litige Stripe clos sans gain confirmé : règlement à examiner manuellement.';
              order.payoutUpdatedAt = new Date();
              await order.save();
            }
          }
        }
        break;
      }

      case 'account.updated': {
        await handleConnectedAccountUpdated(event.data.object);
        break;
      }

      default:
        break;
    }
    if (claimedEvent) await completeEvent(StripeEvent, event).catch((e) => console.error('WEBHOOK EVENT LOG COMPLETE ERROR =>', e?.message));
  } catch (error) {
    console.error('WEBHOOK PROCESSING ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });
    // Libère l'enregistrement pour que Stripe puisse rejouer l'événement.
    if (claimedEvent) await releaseEvent(StripeEvent, event).catch((e) => console.error('WEBHOOK EVENT LOG RELEASE ERROR =>', e?.message));
    // Return 5xx for transient processing failures so Stripe can retry.
    return res.status(500).json({
      received: false,
      code: 'WEBHOOK_PROCESSING_FAILED',
    });
  }

  return res.status(200).json({ received: true });
};

// Webhook « Connect » : événements des comptes connectés (ex. account.updated), signés avec leur propre
// secret (STRIPE_CONNECT_WEBHOOK_SECRET). Même déduplication par event.id que le webhook plateforme.
const handleConnectWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const secret = String(process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '').trim();

  if (!stripe || !signature || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Webhook Connect mal configuré.',
    });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch (error) {
    console.error('CONNECT WEBHOOK SIGNATURE ERROR =>', error.message);
    return res.status(400).json({
      success: false,
      code: 'INVALID_WEBHOOK_SIGNATURE',
      message: 'Signature webhook Stripe invalide.',
    });
  }

  let claimedEvent = false;
  if (event?.id) {
    try {
      if ((await claimEvent(StripeEvent, event)) === 'duplicate') {
        return res.status(200).json({ received: true, duplicate: true });
      }
      claimedEvent = true;
    } catch (error) {
      console.error('CONNECT WEBHOOK EVENT LOG ERROR =>', error?.message);
      return res.status(500).json({ received: false, code: 'WEBHOOK_PROCESSING_FAILED' });
    }
  }

  try {
    if (event.type === 'account.updated') {
      await handleConnectedAccountUpdated(event.data.object);
    }
    // Autres événements Connect : acquittés sans effet (aucune action financière depuis ce endpoint).
    if (claimedEvent) await completeEvent(StripeEvent, event).catch((e) => console.error('CONNECT WEBHOOK EVENT LOG COMPLETE ERROR =>', e?.message));
  } catch (error) {
    console.error('CONNECT WEBHOOK PROCESSING ERROR =>', {
      type: error?.type,
      code: error?.code,
      message: error?.message,
    });
    // Libère l'enregistrement pour que Stripe puisse rejouer l'événement.
    if (claimedEvent) await releaseEvent(StripeEvent, event).catch((e) => console.error('CONNECT WEBHOOK EVENT LOG RELEASE ERROR =>', e?.message));
    return res.status(500).json({ received: false, code: 'WEBHOOK_PROCESSING_FAILED' });
  }

  return res.status(200).json({ received: true });
};

const getAvailablePaymentMethods = async (req, res) => {
  let cash = !isRealProduction();
  const orderId = req.query?.orderId;
  if (isRealProduction() && orderId && isValidObjectId(orderId)) {
    try {
      const { order } = await getAuthorizedOrder(orderId, req);
      cash = isCashAllowedForOrder(order);
    } catch {
      cash = false;
    }
  }
  return res.status(200).json({
    success: true,
    methods: {
      // Fermé tant que le commerce réel n'est pas ouvert et entièrement configuré.
      card: canCreateCardPayment(),
      // Espèces : en production, seulement si le restaurant encaisse lui-même (livraison par le
      // restaurant ou retrait) ; sa commission est alors inscrite au registre.
      cash,
    },
  });
};

const selectCashPayment = async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ORDER_ID',
        message: 'ID commande invalide.',
      });
    }

    const { order, errorStatus, errorMessage } = await getAuthorizedOrder(orderId, req);
    if (!order) {
      return res.status(errorStatus).json({ success: false, message: errorMessage });
    }

    if (order.paymentStatus === 'Remboursé' || order.stripePaymentIntentId || order.stripeCheckoutSessionId) {
      return res.status(409).json({
        success: false,
        code: 'CASH_PAYMENT_NOT_AVAILABLE',
        message: 'Le paiement en espèces ne peut pas être sélectionné pour cette commande.',
      });
    }

    const decision = cashDecision(order);
    if (!decision.allowed) {
      return res.status(409).json({
        success: false,
        code: decision.code || 'CASH_ON_DELIVERY_DISABLED',
        message: decision.message || 'Le paiement en espèces n’est pas disponible pour cette commande.',
      });
    }

    const firstSelection = order.paymentMethod !== 'cash';
    order.paymentMethod = 'cash';
    order.lastPaymentError = '';
    if (order.cashCommissionStatus !== 'settled') order.cashCommissionStatus = 'due';
    if (order.status === 'En attente') order.status = 'Confirmée';
    await order.save();

    // Restaurant et, si un livreur AFROEAT livre, livreurs proches : prévenus comme pour une commande payée.
    if (firstSelection) {
      await require('../utils/courierDispatch').announcePaidOrder(order).catch(() => {});
    }

    return res.status(200).json({
      success: true,
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
    if (!stripe) return stripeUnavailable(res);

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

    order.stripeRefundId = refund.id;
    if (refund.status === 'succeeded') {
      order.paymentStatus = 'Remboursé';
      order.refundedAt = new Date();
    } else if (refund.status === 'failed' || refund.status === 'canceled') {
      order.lastPaymentError = 'Stripe a refusé le remboursement : ' + String(refund.status);
    }
    await order.save();

    if (refund.status === 'succeeded') {
      try {
        const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
          expand: ['latest_charge'],
        });
        const latestCharge = intent.latest_charge;
        const charge = typeof latestCharge === 'string'
          ? await stripe.charges.retrieve(latestCharge)
          : latestCharge;
        if (charge) await reverseOrderTransfers(order, charge);
      } catch (reversalError) {
        // Signed webhook remains the durable retry path if this immediate lookup fails.
        console.error('REFUND PAYOUT REVERSAL DEFERRED =>', {
          orderId: String(order._id),
          message: reversalError?.message,
          code: reversalError?.code,
        });
      }
    }

    return res.status(refund.status === 'failed' || refund.status === 'canceled' ? 502 : 200).json({
      success: refund.status !== 'failed' && refund.status !== 'canceled',
      message: refund.status === 'succeeded'
        ? 'Remboursement confirmé.'
        : refund.status === 'pending'
          ? 'Le remboursement est en cours de traitement par Stripe.'
          : 'Stripe n’a pas pu terminer le remboursement.',
      refundId: refund.id,
      refundStatus: refund.status,
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
  markOrderAsPaid,
  getAvailablePaymentMethods,
  createPaymentIntent,
  createCheckoutSession,
  confirmPayment,
  selectCashPayment,
  handleWebhook,
  handleConnectWebhook,
  refundPayment,
};