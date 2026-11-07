/**
 * =========================================================
 * CARTES ENREGISTRÉES (client) — AFROEAT
 * =========================================================
 *
 * Routes (toutes réservées au rôle `client`) :
 *   GET    /api/payments/cards                       liste les cartes du client
 *   POST   /api/payments/cards/setup-intent          prépare l'ajout d'une carte
 *   PATCH  /api/payments/cards/:paymentMethodId/default
 *   DELETE /api/payments/cards/:paymentMethodId
 *
 * Principes de sécurité :
 * - aucune donnée de carte n'est stockée ici : seuls les identifiants Stripe le sont
 *   (le numéro complet ne transite jamais par ce serveur) ;
 * - une carte n'est modifiée ou supprimée que si elle appartient au client Stripe
 *   de l'utilisateur authentifié ; sinon, réponse 404 (on ne révèle pas l'existence) ;
 * - sans clé Stripe configurée : 503, comme les autres routes de carte.
 */

const PAYMENT_METHOD_ID_PATTERN = /^pm_[A-Za-z0-9_]{6,120}$/;

const stripeUnavailable = (res) =>
  res.status(503).json({
    success: false,
    code: 'STRIPE_NOT_CONFIGURED',
    message: 'Les paiements par carte sont temporairement indisponibles.',
  });

const stripeFailure = (res, error, context) => {
  console.error(`Cartes enregistrées — ${context} :`, error?.type || error?.name, error?.code || '');
  return res.status(502).json({
    success: false,
    code: 'STRIPE_ERROR',
    message: 'Impossible de contacter le service de paiement. Réessaie dans un instant.',
  });
};

/** Forme publique d'une carte : jamais d'empreinte ni de données brutes Stripe. */
const toPublicCard = (paymentMethod, defaultPaymentMethodId) => ({
  id: paymentMethod.id,
  brand: paymentMethod.card?.brand || 'card',
  last4: paymentMethod.card?.last4 || '',
  expMonth: paymentMethod.card?.exp_month ?? null,
  expYear: paymentMethod.card?.exp_year ?? null,
  isDefault: paymentMethod.id === defaultPaymentMethodId,
});

const getDefaultPaymentMethodId = (customer) => {
  if (!customer || customer.deleted) return null;
  const value = customer.invoice_settings?.default_payment_method;
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
};

const getPlatformCountry = () => {
  const country = String(process.env.STRIPE_PLATFORM_COUNTRY || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : undefined;
};

const createSavedCardController = ({ stripe, User }) => {
  const readCustomerId = async (userId) => {
    const user = await User.findById(userId).select('stripeCustomerId email name');
    return { user, customerId: user?.stripeCustomerId || null };
  };

  const ensureCustomer = async (userId) => {
    const { user, customerId } = await readCustomerId(userId);
    if (!user) return null;
    if (customerId) return customerId;

    const customer = await stripe.customers.create({
      email: user.email || undefined,
      name: user.name || undefined,
      metadata: { userId: String(userId), platform: 'afroeat' },
    });

    // Écriture conditionnelle : si une requête concurrente a déjà créé le client,
    // on garde le sien et on supprime le doublon (au mieux).
    const updated = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { stripeCustomerId: { $exists: false } },
          { stripeCustomerId: null },
          { stripeCustomerId: '' },
        ],
      },
      { stripeCustomerId: customer.id },
      { new: true }
    );

    if (updated) return customer.id;

    try {
      await stripe.customers.del(customer.id);
    } catch (error) {
      console.error('Cartes enregistrées — doublon client non supprimé :', error?.message);
    }
    return (await readCustomerId(userId)).customerId;
  };

  /** Retourne la carte si elle appartient bien à ce client Stripe, sinon null. */
  const findOwnedCard = async (customerId, paymentMethodId) => {
    try {
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      const owner =
        typeof paymentMethod?.customer === 'string'
          ? paymentMethod.customer
          : paymentMethod?.customer?.id;
      if (paymentMethod?.type !== 'card' || !owner || owner !== customerId) return null;
      return paymentMethod;
    } catch (error) {
      if (error?.code === 'resource_missing' || error?.statusCode === 404) return null;
      throw error;
    }
  };

  const notFound = (res) =>
    res.status(404).json({ success: false, code: 'CARD_NOT_FOUND', message: 'Carte introuvable.' });

  const invalidId = (res) =>
    res.status(400).json({ success: false, code: 'INVALID_PAYMENT_METHOD', message: 'Identifiant de carte invalide.' });

  const listSavedCards = async (req, res) => {
    if (!stripe) return stripeUnavailable(res);

    try {
      const { customerId } = await readCustomerId(req.user._id);
      if (!customerId) {
        return res.status(200).json({ success: true, cards: [], defaultPaymentMethod: null });
      }

      const [methods, customer] = await Promise.all([
        stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 20 }),
        stripe.customers.retrieve(customerId),
      ]);
      const defaultId = getDefaultPaymentMethodId(customer);
      const cards = (methods?.data || []).map((item) => toPublicCard(item, defaultId));

      return res.status(200).json({
        success: true,
        cards,
        defaultPaymentMethod: cards.some((card) => card.id === defaultId) ? defaultId : null,
      });
    } catch (error) {
      return stripeFailure(res, error, 'liste');
    }
  };

  const createCardSetupIntent = async (req, res) => {
    if (!stripe) return stripeUnavailable(res);

    if (req.body?.consentAccepted !== true) {
      return res.status(400).json({
        success: false,
        code: 'CARD_CONSENT_REQUIRED',
        message: 'Ton accord est nécessaire pour enregistrer une carte.',
      });
    }

    try {
      const customerId = await ensureCustomer(req.user._id);
      if (!customerId) {
        return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { userId: String(req.user._id), platform: 'afroeat' },
      });

      return res.status(200).json({
        success: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        merchantCountryCode: getPlatformCountry(),
      });
    } catch (error) {
      return stripeFailure(res, error, 'setup-intent');
    }
  };

  const setDefaultSavedCard = async (req, res) => {
    if (!stripe) return stripeUnavailable(res);

    const { paymentMethodId } = req.params;
    if (!PAYMENT_METHOD_ID_PATTERN.test(String(paymentMethodId || ''))) return invalidId(res);

    try {
      const { customerId } = await readCustomerId(req.user._id);
      if (!customerId) return notFound(res);

      const card = await findOwnedCard(customerId, paymentMethodId);
      if (!card) return notFound(res);

      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: card.id },
      });

      return res.status(200).json({ success: true, defaultPaymentMethod: card.id });
    } catch (error) {
      return stripeFailure(res, error, 'carte par défaut');
    }
  };

  const removeSavedCard = async (req, res) => {
    if (!stripe) return stripeUnavailable(res);

    const { paymentMethodId } = req.params;
    if (!PAYMENT_METHOD_ID_PATTERN.test(String(paymentMethodId || ''))) return invalidId(res);

    try {
      const { customerId } = await readCustomerId(req.user._id);
      if (!customerId) return notFound(res);

      const card = await findOwnedCard(customerId, paymentMethodId);
      if (!card) return notFound(res);

      await stripe.paymentMethods.detach(card.id);

      return res.status(200).json({ success: true });
    } catch (error) {
      return stripeFailure(res, error, 'suppression');
    }
  };

  return { listSavedCards, createCardSetupIntent, setDefaultSavedCard, removeSavedCard };
};

const defaultStripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

module.exports = {
  ...createSavedCardController({ stripe: defaultStripe, User: require('../models/User') }),
  createSavedCardController,
  toPublicCard,
  PAYMENT_METHOD_ID_PATTERN,
};
