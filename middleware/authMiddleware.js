const jwt = require('jsonwebtoken');
const User = require('../models/User');

const normalizeString = (value) => String(value || '').trim();

/**
 * ✅ CORRIGÉ — Tous les statuts valides selon le rôle
 * - client      → 'active'
 * - restaurant  → 'approved'
 * - livreur     → 'approved'
 * - admin       → 'active' ou 'approved'
 */
const AUTHORIZED_ACTIVE_STATUSES = [
  'active',
  'approved',
  'validated',
  'enabled',
  'completed',
];

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret || normalizeString(secret).length < 32) {
    throw new Error(
      'JWT_SECRET manquant ou trop faible. Définis une vraie clé sécurisée.'
    );
  }

  return secret;
};

const extractBearerToken = (authorizationHeader = '') => {
  const normalized = normalizeString(authorizationHeader);

  if (!normalized) {
    return '';
  }

  const [scheme, ...parts] = normalized.split(' ');

  if (normalizeString(scheme).toLowerCase() !== 'bearer') {
    return '';
  }

  return normalizeString(parts.join(' '));
};

const extractTokenFromCookies = (req) => {
  if (!req || !req.cookies || typeof req.cookies !== 'object') {
    return '';
  }

  const possibleKeys = [
    'token',
    'accessToken',
    'jwt',
    'authToken',
    'afroeat_token',
  ];

  for (const key of possibleKeys) {
    const value = normalizeString(req.cookies[key]);
    if (value) {
      return value;
    }
  }

  return '';
};

const extractAccessTokenFromRequest = (req) => {
  if (!req) {
    return '';
  }

  const headerToken = extractBearerToken(req.headers?.authorization);
  if (headerToken) {
    return headerToken;
  }

  const cookieToken = extractTokenFromCookies(req);
  if (cookieToken) {
    return cookieToken;
  }

  return '';
};

const sanitizeUserForRequest = (user) => {
  if (!user) return null;

  /**
   * ✅ CORRIGÉ — Si accountStatus est absent en base,
   * on met 'active' par défaut au lieu de 'pending_verification'
   * pour ne pas bloquer les anciens comptes sans ce champ.
   */
  const role = user.role || 'client';
  const defaultStatus = role === 'client' ? 'active' : 'approved';

  return {
    _id: user._id,
    id: user._id,
    name: user.name || '',
    email: user.email || '',
    role,
    phone: user.phone || '',
    address: user.address || '',
    profileImage: user.profileImage || '',
    accountStatus: user.accountStatus || defaultStatus,
    isIdentityVerified: Boolean(user.isIdentityVerified),
    isWorkAuthorized: Boolean(user.isWorkAuthorized),
    isAvailable: Boolean(user.isAvailable),
    deliveryProfile: {
      vehicleType: user.deliveryProfile?.vehicleType || '',
      vehicleBrand: user.deliveryProfile?.vehicleBrand || '',
      vehicleColor: user.deliveryProfile?.vehicleColor || '',
      plateNumber: user.deliveryProfile?.plateNumber || '',
      currentLat:
        typeof user.deliveryProfile?.currentLat === 'number'
          ? user.deliveryProfile.currentLat
          : null,
      currentLng:
        typeof user.deliveryProfile?.currentLng === 'number'
          ? user.deliveryProfile.currentLng
          : null,
      lastLocationUpdateAt:
        user.deliveryProfile?.lastLocationUpdateAt || null,
    },
    restaurantProfile: {
      businessName: user.restaurantProfile?.businessName || '',
      contactName: user.restaurantProfile?.contactName || '',
    },
    adminProfile: {
      permissions: Array.isArray(user.adminProfile?.permissions)
        ? user.adminProfile.permissions
        : [],
      lastAdminActionAt: user.adminProfile?.lastAdminActionAt || null,
    },
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
};

const isAccountAllowedToAccessProtectedRoutes = (user) => {
  const status = normalizeString(user?.accountStatus).toLowerCase();

  /**
   * ✅ CORRIGÉ — Si pas de accountStatus en base → on autorise
   * pour ne pas bloquer les anciens comptes migrés.
   */
  if (!user?.accountStatus) {
    return true;
  }

  return AUTHORIZED_ACTIVE_STATUSES.includes(status);
};

const buildAuthContext = ({ token, decoded, user }) => {
  return {
    token: token || '',
    userId: user?._id || decoded?.id || null,
    role: user?.role || 'client',
    accountStatus: user?.accountStatus || 'active',
    issuedAt: decoded?.iat || null,
    expiresAt: decoded?.exp || null,
  };
};

const protect = async (req, res, next) => {
  try {
    const token = extractAccessTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Non autorisé, token manquant.',
      });
    }

    let decoded = null;

    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide ou expiré.',
      });
    }

    if (!decoded?.id) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide.',
      });
    }

    const user = await User.findById(decoded.id).select(
      [
        '_id',
        'name',
        'email',
        'role',
        'phone',
        'address',
        'profileImage',
        'accountStatus',
        'isIdentityVerified',
        'isWorkAuthorized',
        'isAvailable',
        'deliveryProfile.vehicleType',
        'deliveryProfile.vehicleBrand',
        'deliveryProfile.vehicleColor',
        'deliveryProfile.plateNumber',
        'deliveryProfile.currentLat',
        'deliveryProfile.currentLng',
        'deliveryProfile.lastLocationUpdateAt',
        'restaurantProfile.businessName',
        'restaurantProfile.contactName',
        'adminProfile.permissions',
        'adminProfile.lastAdminActionAt',
        'createdAt',
        'updatedAt',
      ].join(' ')
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable.',
      });
    }

    if (!isAccountAllowedToAccessProtectedRoutes(user)) {
      const normalizedStatus = normalizeString(user.accountStatus).toLowerCase();

      if (normalizedStatus === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Compte suspendu.',
        });
      }

      if (normalizedStatus === 'rejected') {
        return res.status(403).json({
          success: false,
          message: 'Compte rejeté.',
        });
      }

      return res.status(403).json({
        success: false,
        message: 'Compte non actif. Accès refusé.',
      });
    }

    req.user = sanitizeUserForRequest(user);
    req.token = token;
    req.auth = buildAuthContext({ token, decoded, user });

    return next();
  } catch (error) {
    console.error('AUTH MIDDLEWARE ERROR =>', error);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur durant l'authentification.",
    });
  }
};

module.exports = {
  protect,
  getJwtSecret,
  extractBearerToken,
  extractTokenFromCookies,
  extractAccessTokenFromRequest,
  sanitizeUserForRequest,
  isAccountAllowedToAccessProtectedRoutes,
};