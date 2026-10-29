'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Order = require('../models/Order');
const {
  reconcileOrderPayout,
  isPartnerReadyForTransfers,
  isConnectPayoutsEnabled,
} = require('../utils/marketplacePayouts');

const getStripe = () => {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY est manquant.');
  return require('stripe')(secretKey);
};

const listCountryCodes = (value) => String(value || '')
  .split(',')
  .map((country) => country.trim().toUpperCase())
  .filter((country) => /^[A-Z]{2}$/.test(country));

const getPublicApiUrl = () => {
  const raw = String(process.env.PUBLIC_API_URL || '').trim();
  if (!raw) throw new Error('PUBLIC_API_URL est manquant.');
  const url = new URL(raw);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_API_URL doit utiliser HTTPS.');
  }
  if (process.env.NODE_ENV === 'production' &&
      (
        ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase()) ||
        ['.invalid', '.example', '.test'].some((suffix) => url.hostname.toLowerCase().endsWith(suffix))
      )) {
    throw new Error('PUBLIC_API_URL doit utiliser un domaine public réel en production.');
  }
  return url.toString().replace(/\/$/, '');
};

const getJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (secret.length < 32) throw new Error('JWT_SECRET est manquant ou trop faible.');
  return secret;
};

const createOnboardingLink = async (user) => {
  if (!user?.stripeConnectAccountId) throw new Error('Compte Stripe Connect manquant.');
  const stripe = getStripe();
  const apiUrl = getPublicApiUrl();
  const refreshToken = jwt.sign(
    { accountId: user.stripeConnectAccountId, purpose: 'connect_refresh' },
    getJwtSecret(),
    { subject: user._id.toString(), issuer: 'afroeat-connect', expiresIn: '30m' }
  );
  const link = await stripe.accountLinks.create({
    account: user.stripeConnectAccountId,
    type: 'account_onboarding',
    refresh_url: apiUrl + '/api/payments/connect/refresh?token=' + encodeURIComponent(refreshToken),
    return_url: apiUrl + '/api/payments/connect/return',
  });
  return link.url;
};

const refreshAccountStatus = async (user, account) => {
  user.stripeConnectDetailsSubmitted = Boolean(account.details_submitted);
  user.stripeConnectTransfersEnabled = account.capabilities?.transfers === 'active';
  user.stripeConnectPayoutsEnabled = Boolean(account.payouts_enabled);
  user.stripeConnectRequirementsDueCount = Array.isArray(account.requirements?.currently_due)
    ? account.requirements.currently_due.length
    : 0;
  if (account.country) user.countryCode = String(account.country).toUpperCase();
  await user.save();
};

const getConnectStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      '_id role countryCode stripeConnectAccountId stripeConnectDetailsSubmitted stripeConnectTransfersEnabled stripeConnectPayoutsEnabled stripeConnectRequirementsDueCount'
    );
    if (!user) return res.status(404).json({ success: false, message: 'Compte introuvable.' });

    if (!user.stripeConnectAccountId) {
      return res.status(200).json({
        success: true,
        connected: false,
        accountReady: false,
        payoutsFeatureEnabled: isConnectPayoutsEnabled(),
        detailsSubmitted: false,
        transfersEnabled: false,
        payoutsEnabled: false,
        requirementsDueCount: 0,
        countryCode: user.countryCode || '',
      });
    }

    const account = await getStripe().accounts.retrieve(user.stripeConnectAccountId);
    await refreshAccountStatus(user, account);
    const accountReady = isPartnerReadyForTransfers(user);
    const payoutsFeatureEnabled = require('../utils/marketplacePayouts').isConnectPayoutsEnabled();
    return res.status(200).json({
      success: true,
      connected: accountReady && payoutsFeatureEnabled,
      accountReady,
      payoutsFeatureEnabled,
      detailsSubmitted: user.stripeConnectDetailsSubmitted,
      transfersEnabled: user.stripeConnectTransfersEnabled,
      payoutsEnabled: user.stripeConnectPayoutsEnabled,
      requirementsDueCount: user.stripeConnectRequirementsDueCount,
      countryCode: user.countryCode || '',
    });
  } catch (error) {
    console.error('STRIPE CONNECT STATUS ERROR =>', error?.message);
    return res.status(503).json({
      success: false,
      message: 'Impossible de récupérer le statut Stripe Connect pour le moment.',
    });
  }
};

const startConnectOnboarding = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'Compte introuvable.' });
    if (!['restaurant', 'livreur'].includes(String(user.role || '').toLowerCase())) {
      return res.status(403).json({ success: false, message: 'Seuls les restaurants et livreurs peuvent recevoir des versements.' });
    }

    const allowedCountries = listCountryCodes(process.env.STRIPE_CONNECT_COUNTRIES);
    if (!allowedCountries.length) {
      return res.status(503).json({
        success: false,
        code: 'CONNECT_COUNTRIES_NOT_CONFIGURED',
        message: 'Les pays autorisés pour les versements Stripe ne sont pas configurés.',
      });
    }

    const countryCode = String(req.body?.countryCode || user.countryCode || '')
      .trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(400).json({
        success: false,
        message: 'Saisis le code pays ISO à deux lettres de ton compte de versement.',
      });
    }
    if (!allowedCountries.includes(countryCode)) {
      return res.status(400).json({ success: false, message: 'Les versements ne sont pas encore ouverts dans ce pays.' });
    }

    const platformCountry = String(process.env.STRIPE_PLATFORM_COUNTRY || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(platformCountry)) {
      return res.status(503).json({ success: false, message: 'Le pays du compte plateforme Stripe n’est pas configuré.' });
    }
    const crossBorderCountries = listCountryCodes(process.env.STRIPE_CONNECT_CROSS_BORDER_COUNTRIES);
    if (countryCode !== platformCountry && !crossBorderCountries.includes(countryCode)) {
      return res.status(400).json({
        success: false,
        message: 'Les transferts transfrontaliers vers ce pays ne sont pas autorisés par la configuration Stripe.',
      });
    }

    const stripe = getStripe();
    if (user.stripeConnectAccountId) {
      const existing = await stripe.accounts.retrieve(user.stripeConnectAccountId);
      if (existing.country !== countryCode) {
        return res.status(409).json({
          success: false,
          message: 'Le pays Stripe d’un compte déjà créé ne peut pas être modifié ici.',
        });
      }
      if (!user.countryCode) {
        user.countryCode = countryCode;
        await user.save();
      }
    } else {
      const account = await stripe.accounts.create(
        {
          type: 'express',
          country: countryCode,
          email: user.email,
          capabilities: { transfers: { requested: true } },
          business_profile: {
            name: user.name,
            url: String(process.env.PUBLIC_WEB_URL || '').trim() || undefined,
          },
          metadata: { userId: user._id.toString(), platform: 'afroeat' },
        },
        { idempotencyKey: 'afroeat_connect_account_' + user._id.toString() }
      );
      user.stripeConnectAccountId = account.id;
      await refreshAccountStatus(user, account);
    }

    return res.status(200).json({ success: true, url: await createOnboardingLink(user) });
  } catch (error) {
    console.error('STRIPE CONNECT ONBOARDING ERROR =>', {
      type: error?.type, code: error?.code, message: error?.message,
    });
    return res.status(503).json({
      success: false,
      message: 'Impossible de démarrer la configuration Stripe pour le moment.',
    });
  }
};

const createConnectDashboardLink = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('_id stripeConnectAccountId');
    if (!user?.stripeConnectAccountId) {
      return res.status(409).json({ success: false, message: 'Aucun compte Stripe Connect n’est associé.' });
    }
    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
    if (account.type !== 'express' || !account.details_submitted) {
      return res.status(409).json({ success: false, message: 'Termine d’abord la configuration Stripe.' });
    }
    const link = await stripe.accounts.createLoginLink(user.stripeConnectAccountId);
    return res.status(200).json({ success: true, url: link.url });
  } catch (error) {
    console.error('STRIPE CONNECT DASHBOARD LINK ERROR =>', error?.message);
    return res.status(503).json({ success: false, message: 'Le tableau Stripe est momentanément indisponible.' });
  }
};

const refreshConnectOnboarding = async (req, res) => {
  try {
    const token = String(req.query?.token || '');
    const decoded = jwt.verify(token, getJwtSecret(), { issuer: 'afroeat-connect' });
    if (decoded?.purpose !== 'connect_refresh' || !decoded?.sub || !decoded?.accountId) {
      return res.status(400).send('Lien de configuration invalide. Retourne dans Afroeat.');
    }
    const user = await User.findById(decoded.sub).select('_id stripeConnectAccountId');
    if (!user || user.stripeConnectAccountId !== decoded.accountId) {
      return res.status(403).send('Compte Stripe indisponible. Retourne dans Afroeat.');
    }
    return res.redirect(303, await createOnboardingLink(user));
  } catch (error) {
    console.error('STRIPE CONNECT REFRESH ERROR =>', error?.message);
    return res.status(400).send('Ce lien a expiré. Retourne dans Afroeat pour reprendre.');
  }
};

const connectReturnPage = (req, res) => res.status(200).type('html').send(
  '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Afroeat</title><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#20251f"><h1>Configuration envoyée</h1><p>Tu peux revenir dans Afroeat. La vérification des versements peut prendre un peu de temps.</p></body></html>'
);

const handleConnectedAccountUpdated = async (account) => {
  if (!account?.id) return;
  await User.findOneAndUpdate(
    { stripeConnectAccountId: account.id },
    {
      $set: {
        stripeConnectDetailsSubmitted: Boolean(account.details_submitted),
        stripeConnectTransfersEnabled: account.capabilities?.transfers === 'active',
        stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
        stripeConnectRequirementsDueCount: Array.isArray(account.requirements?.currently_due)
          ? account.requirements.currently_due.length
          : 0,
        ...(account.country ? { countryCode: String(account.country).toUpperCase() } : {}),
      },
    }
  );
};

const reconcileDeliveredOrderTransfers = async (req, res) => {
  try {
    const orderId = String(req.params?.orderId || '');
    if (!/^[a-f\d]{24}$/i.test(orderId)) {
      return res.status(400).json({ success: false, message: 'ID commande invalide.' });
    }
    const order = await Order.findById(orderId).select('_id status payoutStatus');
    if (!order) return res.status(404).json({ success: false, message: 'Commande introuvable.' });
    if (order.status !== 'Livrée') {
      return res.status(409).json({ success: false, message: 'Seules les commandes livrées peuvent être rapprochées.' });
    }
    const result = await reconcileOrderPayout(orderId);
    const updated = await Order.findById(orderId).select('_id payoutStatus payoutError');
    return res.status(result.success ? 200 : 409).json({
      success: Boolean(result.success),
      payoutStatus: updated?.payoutStatus || 'unknown',
      message: result.success ? 'Rapprochement exécuté.' : 'Le versement reste à rapprocher.',
    });
  } catch (error) {
    console.error('STRIPE CONNECT RECONCILIATION ERROR =>', error?.message);
    return res.status(500).json({ success: false, message: 'Rapprochement impossible.' });
  }
};

const listPayoutReconciliation = async (req, res) => {
  try {
    const orders = await Order.find({ payoutStatus: 'reconciliation_required' })
      .sort({ payoutUpdatedAt: -1, updatedAt: -1 })
      .limit(100)
      .select('_id status paymentStatus paymentMethod totalPrice currency payoutStatus payoutError payoutUpdatedAt createdAt');
    return res.status(200).json({
      success: true,
      count: orders.length,
      orders: orders.map((order) => ({
        orderId: String(order._id),
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        totalPrice: order.totalPrice,
        currency: order.currency,
        payoutStatus: order.payoutStatus,
        reason: order.payoutError,
        updatedAt: order.payoutUpdatedAt || order.createdAt,
      })),
    });
  } catch (error) {
    console.error('STRIPE CONNECT RECONCILIATION LIST ERROR =>', error?.message);
    return res.status(500).json({ success: false, message: 'Liste de rapprochement indisponible.' });
  }
};

const resolvePayoutReconciliation = async (req, res) => {
  try {
    const orderId = String(req.params?.orderId || '');
    const note = String(req.body?.note || '').trim();
    if (!/^[a-f\d]{24}$/i.test(orderId)) {
      return res.status(400).json({ success: false, message: 'ID commande invalide.' });
    }
    if (note.length < 10 || note.length > 500) {
      return res.status(400).json({ success: false, message: 'Ajoute une note de rapprochement de 10 à 500 caractères.' });
    }
    const order = await Order.findOne({ _id: orderId, payoutStatus: 'reconciliation_required' });
    if (!order) return res.status(404).json({ success: false, message: 'Élément de rapprochement introuvable.' });
    if (order.stripeDisputeId && !order.stripeDisputeClosedAt) {
      return res.status(409).json({ success: false, message: 'Attends la clôture du litige Stripe avant de clôturer ce rapprochement.' });
    }
    order.payoutStatus = 'manually_reconciled';
    order.payoutResolutionNote = note;
    order.payoutResolvedAt = new Date();
    order.payoutResolvedBy = req.user._id;
    order.payoutUpdatedAt = new Date();
    await order.save();
    return res.status(200).json({ success: true, payoutStatus: order.payoutStatus });
  } catch (error) {
    console.error('STRIPE CONNECT MANUAL RESOLUTION ERROR =>', error?.message);
    return res.status(500).json({ success: false, message: 'Clôture du rapprochement impossible.' });
  }
};

module.exports = {
  getConnectStatus,
  startConnectOnboarding,
  createConnectDashboardLink,
  refreshConnectOnboarding,
  connectReturnPage,
  handleConnectedAccountUpdated,
  reconcileDeliveredOrderTransfers,
  listPayoutReconciliation,
  resolvePayoutReconciliation,
};
