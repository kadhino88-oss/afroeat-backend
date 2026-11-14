'use strict';

const PartnerApplication = require('../models/PartnerApplication');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { buildRestaurantFromApplication, geocodeAddress } = require('../utils/partnerRestaurant');
const {
  INVITE_MESSAGES,
  generateInviteToken,
  hashInviteToken,
  getInviteState,
  validateInviteRegistration,
} = require('../utils/partnerInvite');
const { validateApplication, STATUSES } = require('../utils/partnerApplication');

const mailer = require('../utils/mailer');
const { adminNewApplicationEmail, applicantConfirmationEmail, inviteEmail } = require('../utils/partnerMails');

/**
 * Prévient l'équipe (PARTNER_NOTIFY_EMAIL) et accuse réception au candidat.
 * Un échec d'envoi n'empêche jamais l'enregistrement de la candidature.
 */
const notifyNewApplication = async (data) => {
  try {
    const base = publicWebBase();
    const adminTo = String(process.env.PARTNER_NOTIFY_EMAIL || '').trim();
    const jobs = [mailer.sendMail({ to: data.email, ...applicantConfirmationEmail(data) })];
    if (adminTo) {
      jobs.push(mailer.sendMail({ to: adminTo, ...adminNewApplicationEmail(data, base ? `${base}/admin/partner-applications` : '') }));
    }
    const results = await Promise.allSettled(jobs);
    results.forEach((result, index) => {
      const reason = result.status === 'rejected' ? result.reason?.message : result.value?.sent ? '' : result.value?.reason;
      if (reason) console.error(`Partner mail not sent (${index === 0 ? 'candidat' : 'équipe'}): ${reason}`);
    });
  } catch (error) {
    console.error('Partner application mail error:', error.message);
  }
};

const createApplication = async (req, res) => {
  try {
    // Champ piège invisible : un robot le remplit, un humain non. On répond « OK » sans rien enregistrer.
    if (String(req.body?.company || '').trim()) {
      return res.status(201).json({ success: true, message: 'Demande reçue.' });
    }

    const data = validateApplication(req.body);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const duplicate = await PartnerApplication.findOne({
      email: data.email,
      businessName: data.businessName,
      createdAt: { $gte: since },
    }).select('_id');

    if (duplicate) {
      return res.status(200).json({ success: true, message: 'Demande déjà reçue, nous revenons vers toi.' });
    }

    await PartnerApplication.create(data);
    await notifyNewApplication(data);
    return res.status(201).json({ success: true, message: 'Demande reçue. Nous te contactons très vite.' });
  } catch (error) {
    const isValidation = /obligatoire|invalide|commencer par/.test(error.message || '');
    if (!isValidation) console.error('Partner application error:', error.message);
    return res.status(isValidation ? 400 : 500).json({
      success: false,
      message: isValidation ? error.message : 'Erreur serveur.',
    });
  }
};

const listApplications = async (req, res) => {
  try {
    const status = String(req.query.status || '');
    const filter = STATUSES.includes(status) ? { status } : {};
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [items, total] = await Promise.all([
      PartnerApplication.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-inviteTokenHash').lean(),
      PartnerApplication.countDocuments(filter),
    ]);

    return res.json({ success: true, total, page, limit, applications: items });
  } catch (error) {
    console.error('List partner applications error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const updateApplication = async (req, res) => {
  try {
    const update = {};
    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ success: false, message: 'Statut invalide.' });
      }
      update.status = req.body.status;
    }
    if (req.body?.adminNote !== undefined) {
      update.adminNote = String(req.body.adminNote).trim().slice(0, 1000);
    }

    const application = await PartnerApplication.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!application) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    return res.json({ success: true, application });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Identifiant invalide.' });
  }
};

const publicWebBase = () => {
  const raw = String(process.env.PUBLIC_WEB_URL || '').split(',')[0].trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(raw) ? raw : '';
};

const INVITE_PROJECTION = '+inviteTokenHash';

/**
 * ADMIN — génère un lien d'invitation à usage unique (valable 7 jours).
 * Le partenaire y crée lui-même son compte et choisit son mot de passe : personne d'autre ne le connaît.
 */
const createInvite = async (req, res) => {
  try {
    const base = publicWebBase();
    if (!base) {
      return res.status(503).json({ success: false, message: "PUBLIC_WEB_URL n'est pas configurée." });
    }

    const application = await PartnerApplication.findById(req.params.id);
    if (!application) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    if (application.status === 'rejected') {
      return res.status(409).json({ success: false, message: 'Cette demande a été refusée.' });
    }
    if (application.inviteUsedAt) {
      return res.status(409).json({ success: false, message: 'Le compte de ce partenaire a déjà été créé.' });
    }
    if (await User.findOne({ email: application.email }).select('_id')) {
      return res.status(409).json({ success: false, message: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    const { token, tokenHash, expiresAt } = generateInviteToken();
    application.inviteTokenHash = tokenHash;
    application.inviteExpiresAt = expiresAt;
    application.inviteUsedAt = null;
    application.status = 'approved';
    await application.save();

    const inviteUrl = `${base}/auth/invite?token=${token}`;
    // Si l'e-mail est configuré, le lien part directement chez le candidat (en plus de l'affichage admin).
    let emailSent = false;
    try {
      const result = await mailer.sendMail({ to: application.email, ...inviteEmail(application, inviteUrl, expiresAt) });
      emailSent = Boolean(result?.sent);
      if (!emailSent) console.error(`Partner invite mail not sent: ${result?.reason || 'inconnu'}`);
    } catch (error) {
      console.error('Partner invite mail error:', error.message);
    }

    return res.json({ success: true, inviteUrl, expiresAt, emailSent });
  } catch (error) {
    console.error('Partner invite error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const findInvitedApplication = async (token) => {
  const value = String(token || '');
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  return PartnerApplication.findOne({ inviteTokenHash: hashInviteToken(value) }).select(INVITE_PROJECTION);
};

const inviteError = (res, code) =>
  res.status(code === 'INVITE_INVALID' ? 404 : 410).json({
    success: false,
    code,
    message: INVITE_MESSAGES[code] || INVITE_MESSAGES.INVITE_INVALID,
  });

/** PUBLIC — ce que la page d'invitation affiche (aucune donnée sensible). */
const getInvite = async (req, res) => {
  try {
    const application = await findInvitedApplication(req.params.token);
    const state = getInviteState(application);
    if (!state.ok) return inviteError(res, state.code);

    return res.json({
      success: true,
      invite: {
        businessName: application.businessName,
        businessType: application.businessType,
        email: application.email,
        contactName: application.contactName,
        phone: application.phone,
        expiresAt: application.inviteExpiresAt,
      },
    });
  } catch (error) {
    console.error('Get invite error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** PUBLIC — le partenaire crée son compte et choisit son mot de passe. */
const registerFromInvite = async (req, res) => {
  let claimed = null;
  try {
    const application = await findInvitedApplication(req.params.token);
    const state = getInviteState(application);
    if (!state.ok) return inviteError(res, state.code);

    let data;
    try {
      data = validateInviteRegistration(req.body);
    } catch (validationError) {
      return res.status(400).json({ success: false, message: validationError.message });
    }

    if (await User.findOne({ email: application.email }).select('_id')) {
      return res.status(409).json({ success: false, message: 'Un compte existe déjà avec cette adresse e-mail.' });
    }

    // On « consomme » l'invitation avant de créer le compte : deux envois simultanés ne créent qu'un compte.
    claimed = await PartnerApplication.findOneAndUpdate(
      { _id: application._id, inviteUsedAt: null },
      { inviteUsedAt: new Date() },
      { new: true }
    );
    if (!claimed) return inviteError(res, 'INVITE_USED');

    const isCourier = application.businessType === 'courier';
    const user = new User({
      name: data.name,
      email: application.email,
      password: data.password,
      role: isCourier ? 'livreur' : 'restaurant',
      phone: data.phone,
      address: `${application.address}, ${application.city}`,
      country: application.country || 'Suisse',
      isIdentityVerified: false,
      isWorkAuthorized: false,
      // L'équipe AFROEAT a déjà vérifié la candidature avant d'envoyer l'invitation.
      // Un livreur ne reçoit aucune course tant que son identité et son autorisation de travail
      // ne sont pas vérifiées par l'admin, et qu'il ne s'est pas déclaré disponible.
      accountStatus: 'active',
      isAvailable: false,
    });
    await user.save();

    await PartnerApplication.updateOne({ _id: application._id }, { accountUser: user._id });

    // Restaurant : sa fiche est créée tout de suite (fermée), pour qu'il n'arrive pas sur un espace vide.
    let restaurantCreated = false;
    if (!isCourier) {
      try {
        const point = await geocodeAddress(application.address, application.city, application.country);
        await Restaurant.create(buildRestaurantFromApplication(application, user._id, point));
        restaurantCreated = true;
      } catch (restaurantError) {
        console.error('Partner restaurant creation error:', restaurantError.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Compte créé. Tu peux maintenant te connecter.',
      email: application.email,
      role: isCourier ? 'livreur' : 'restaurant',
      restaurantCreated,
    });
  } catch (error) {
    if (claimed) {
      await PartnerApplication.updateOne({ _id: claimed._id }, { inviteUsedAt: null }).catch(() => {});
    }
    console.error('Register from invite error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = {
  createApplication,
  listApplications,
  updateApplication,
  createInvite,
  getInvite,
  registerFromInvite,
};
