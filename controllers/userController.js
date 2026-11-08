const jwt = require('jsonwebtoken');
const User = require('../models/User');

const allowedRoles = ['client', 'restaurant', 'livreur'];
const partnerRoles = ['restaurant', 'livreur'];
const driverVisibleStatuses = ['active'];

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret || String(secret).trim().length < 32) {
    throw new Error(
      'JWT_SECRET manquant ou trop faible. Définis une vraie clé sécurisée en variable d’environnement.'
    );
  }

  return secret;
};

const normalizeString = (value) => {
  return String(value || '').trim();
};

const normalizeEmail = (value) => {
  return normalizeString(value).toLowerCase();
};

const normalizePhone = (value) => {
  return normalizeString(value).replace(/[^\d+]/g, '');
};

const normalizeRole = (value) => {
  const role = normalizeString(value).toLowerCase();
  return allowedRoles.includes(role) ? role : 'client';
};

const normalizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const normalizeDriverSort = (value) => {
  const sort = normalizeString(value).toLowerCase();

  if (['recent', 'oldest', 'name'].includes(sort)) {
    return sort;
  }

  return 'recent';
};

const normalizeDriverStatusFilter = (value) => {
  const status = normalizeString(value).toLowerCase();

  if (!status || status === 'active') return 'active';
  if (status === 'all') return 'all';

  return 'active';
};

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isStrongPassword = (password) => {
  const value = String(password || '');

  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
};

const isAdultFromBirthDate = (birthDate) => {
  if (!birthDate) return false;

  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const month = today.getMonth() - date.getMonth();

  if (month < 0 || (month === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age >= 18;
};

const formatUser = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  role: user.role || 'client',
  phone: user.phone || '',
  address: user.address || '',
  country: user.country || '',
  nationality: user.nationality || '',
  birthDate: user.birthDate || null,
  isIdentityVerified: Boolean(user.isIdentityVerified),
  isWorkAuthorized: Boolean(user.isWorkAuthorized),
  accountStatus: user.accountStatus || 'pending_verification',
});

const formatDriver = (user) => ({
  _id: user._id,
  id: user._id,
  name: user.name || '',
  email: user.email || '',
  role: user.role || 'livreur',
  phone: user.phone || '',
  accountStatus: user.accountStatus || 'pending_verification',
  isIdentityVerified: user.isIdentityVerified === true,
  isWorkAuthorized: user.isWorkAuthorized === true,
  isAvailable: user.isAvailable === true,
  createdAt: user.createdAt || null,
});

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
};

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Non autorisé, token manquant',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token manquant',
      });
    }

    const decoded = jwt.verify(token, getJwtSecret());

    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide',
      });
    }

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable ou non autorisé',
      });
    }

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Compte suspendu',
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token invalide ou expiré',
    });
  }
};

const validateRegistrationPayload = (body) => {
  const name = normalizeString(body?.name);
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const role = normalizeRole(body?.role);
  const phone = normalizePhone(body?.phone);
  const address = normalizeString(body?.address);
  const country = normalizeString(body?.country);
  const nationality = normalizeString(body?.nationality);
  const birthDate = normalizeString(body?.birthDate);

  const identityDocument = body?.identityDocument || null;
  const workAuthorization = body?.workAuthorization || null;

  if (!name || name.length < 2) {
    throw new Error('Le nom est obligatoire.');
  }

  if (!email || !isValidEmail(email)) {
    throw new Error("L'adresse email est invalide.");
  }

  if (!password) {
    throw new Error('Le mot de passe est obligatoire.');
  }

  if (!isStrongPassword(password)) {
    throw new Error(
      'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.'
    );
  }

  if (!phone || phone.length < 8) {
    throw new Error('Le numéro de téléphone est invalide.');
  }

  if (!address) {
    throw new Error("L'adresse est obligatoire.");
  }

  if (!country) {
    throw new Error('Le pays est obligatoire.');
  }

  // Client : seuls nom, e-mail, mot de passe, téléphone, adresse et pays sont demandés à l'inscription.
  // Partenaires (restaurant, livreur) : vérification d'identité complète.
  const requiresIdentity = role !== 'client';

  if (requiresIdentity && !nationality) {
    throw new Error('La nationalité est obligatoire.');
  }

  if (requiresIdentity && !birthDate) {
    throw new Error('La date de naissance est obligatoire.');
  }

  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    throw new Error('La date de naissance doit être au format AAAA-MM-JJ.');
  }

  if (birthDate && !isAdultFromBirthDate(birthDate)) {
    throw new Error('Vous devez être majeur pour créer ce compte.');
  }

  if (requiresIdentity && (!identityDocument || typeof identityDocument !== 'object')) {
    throw new Error("Une pièce d'identité est obligatoire.");
  }

  if (requiresIdentity && !normalizeString(identityDocument?.number)) {
    throw new Error("Le numéro de pièce d'identité est obligatoire.");
  }

  if (partnerRoles.includes(role)) {
    const allowPartnerSelfRegister =
      String(process.env.ALLOW_PARTNER_SELF_REGISTER || 'false').toLowerCase() ===
      'true';

    if (!allowPartnerSelfRegister) {
      throw new Error(
        'Les comptes restaurant et livreur sont créés uniquement après validation partenaire.'
      );
    }

    if (!workAuthorization || typeof workAuthorization !== 'object') {
      throw new Error(
        "Une autorisation de travail valide est obligatoire pour ce type de compte."
      );
    }

    if (!normalizeString(workAuthorization?.number)) {
      throw new Error(
        "Le numéro d'autorisation de travail est obligatoire."
      );
    }
  }

  return {
    name,
    email,
    password,
    role,
    phone,
    address,
    country,
    nationality,
    birthDate,
    identityDocument:
      identityDocument && typeof identityDocument === 'object'
        ? {
            type: normalizeString(identityDocument?.type) || 'identity_card',
            number: normalizeString(identityDocument?.number),
          }
        : null,
    workAuthorization:
      workAuthorization && typeof workAuthorization === 'object'
        ? {
            type:
              normalizeString(workAuthorization?.type) || 'work_authorization',
            number: normalizeString(workAuthorization?.number),
          }
        : null,
  };
};

const registerUser = async (req, res) => {
  try {
    const payload = validateRegistrationPayload(req.body);

    const userExists = await User.findOne({ email: payload.email });

    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'Utilisateur déjà existant',
      });
    }

    const newUser = new User({
      name: payload.name,
      email: payload.email,
      password: payload.password,
      role: payload.role,
      phone: payload.phone,
      address: payload.address,
      country: payload.country,
      nationality: payload.nationality,
      birthDate: payload.birthDate,
      identityDocument: payload.identityDocument,
      workAuthorization: payload.workAuthorization,
      isIdentityVerified: false,
      isWorkAuthorized: payload.role === 'client',
      accountStatus: 'pending_verification',
    });

    await newUser.save();

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      token,
      user: formatUser(newUser),
    });
  } catch (error) {
    const statusCode =
      error.message &&
      [
        'Le nom est obligatoire.',
        "L'adresse email est invalide.",
        'Le mot de passe est obligatoire.',
        'Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.',
        'Le numéro de téléphone est invalide.',
        "L'adresse est obligatoire.",
        'Le pays est obligatoire.',
        'La nationalité est obligatoire.',
        'La date de naissance est obligatoire.',
        'La date de naissance doit être au format AAAA-MM-JJ.',
        'Vous devez être majeur pour créer ce compte.',
        "Une pièce d'identité est obligatoire.",
        "Le numéro de pièce d'identité est obligatoire.",
        "Une autorisation de travail valide est obligatoire pour ce type de compte.",
        "Le numéro d'autorisation de travail est obligatoire.",
        'Les comptes restaurant et livreur sont créés uniquement après validation partenaire.',
      ].includes(error.message)
        ? 400
        : 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Erreur serveur',
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const requestedRole = req.body?.role ? normalizeRole(req.body.role) : null;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Les champs email et password sont obligatoires',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "L'adresse email est invalide.",
      });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Mot de passe incorrect',
      });
    }

    if (requestedRole && user.role !== requestedRole) {
      return res.status(403).json({
        success: false,
        message: `Ce compte appartient à l’espace ${user.role}, pas à l’espace ${requestedRole}`,
      });
    }

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Ce compte est suspendu.',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      token,
      user: formatUser(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur',
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
      });
    }

    return res.status(200).json({
      success: true,
      user: formatUser(user),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur',
    });
  }
};

const updateMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
      });
    }

    const safeUpdates = {
      name: req.body?.name ? normalizeString(req.body.name) : user.name,
      phone: req.body?.phone ? normalizePhone(req.body.phone) : user.phone,
      address: req.body?.address ? normalizeString(req.body.address) : user.address,
      country: req.body?.country ? normalizeString(req.body.country) : user.country,
      nationality: req.body?.nationality
        ? normalizeString(req.body.nationality)
        : user.nationality,
      pushToken:
        typeof req.body?.pushToken === 'string' && req.body.pushToken.trim()
          ? normalizeString(req.body.pushToken)
          : user.pushToken,
    };

    if (req.body?.email) {
      const nextEmail = normalizeEmail(req.body.email);

      if (!isValidEmail(nextEmail)) {
        return res.status(400).json({
          success: false,
          message: "L'adresse email est invalide.",
        });
      }

      const existingUser = await User.findOne({
        email: nextEmail,
        _id: { $ne: user._id },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Cette adresse email est déjà utilisée.',
        });
      }

      safeUpdates.email = nextEmail;
    }

    const updatedUser = await User.findByIdAndUpdate(user._id, safeUpdates, {
      new: true,
      runValidators: true,
    }).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user: formatUser(updatedUser),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur',
    });
  }
};

const getDrivers = async (req, res) => {
  try {
    if (!req.user || !['admin', 'restaurant'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé',
      });
    }

    const search = normalizeString(req.query?.search);
    const status = normalizeDriverStatusFilter(req.query?.status);
    const sort = normalizeDriverSort(req.query?.sort);
    const page = normalizePositiveInteger(req.query?.page, 1);
    const limit = Math.min(normalizePositiveInteger(req.query?.limit, 20), 50);
    const skip = (page - 1) * limit;

    const filter = {
      role: 'livreur',
    };

    // The default directory is an assignment picker: expose only couriers
    // who have an active account, verified identity/work status, and are online.
    // Only admins may request the full unfiltered directory with ?status=all.
    const requireAssignableCourier =
      req.user.role !== 'admin' || status === 'active';

    if (requireAssignableCourier) {
      filter.accountStatus = { $in: driverVisibleStatuses };
      filter.isIdentityVerified = true;
      filter.isWorkAuthorized = true;
      filter.isAvailable = true;
    }

    if (search) {
      const safeSearchRegex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { name: safeSearchRegex },
        { email: safeSearchRegex },
        { phone: safeSearchRegex },
      ];
    }

    let sortOption = { createdAt: -1 };

    if (sort === 'oldest') {
      sortOption = { createdAt: 1 };
    } else if (sort === 'name') {
      sortOption = { name: 1, createdAt: -1 };
    }

    const [drivers, total] = await Promise.all([
      User.find(filter)
        .select('_id name email role phone accountStatus isIdentityVerified isWorkAuthorized isAvailable createdAt')
        .sort(sortOption)
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: drivers.length,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      drivers: drivers.map(formatDriver),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur',
    });
  }
};

module.exports = {
  registerUser,
  validateRegistrationPayload,
  loginUser,
  getMe,
  updateMe,
  getDrivers,
  protect,
};