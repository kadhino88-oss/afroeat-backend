const normalizeString = (value) => String(value || '').trim().toLowerCase();

const normalizeArray = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
};

const getCurrentUserRole = (req) => normalizeString(req?.user?.role);

const getCurrentUserId = (req) =>
  String(req?.user?._id || req?.user?.id || '').trim();

const getTargetUserId = (req) =>
  String(req?.params?.userId || req?.params?.id || req?.body?.userId || '').trim();

const hasAnyAdminPermission = (req, requiredPermissions = []) => {
  const currentPermissions = normalizeArray(req?.user?.adminProfile?.permissions);
  const expectedPermissions = normalizeArray(requiredPermissions);

  if (!expectedPermissions.length) {
    return true;
  }

  return expectedPermissions.some((permission) =>
    currentPermissions.includes(permission)
  );
};

const forbidIfNoUser = (req, res) => {
  if (req?.user) {
    return false;
  }

  res.status(401).json({
    success: false,
    message: 'Non autorisé.',
  });

  return true;
};

const allowRoles = (...roles) => {
  const allowedRoles = normalizeArray(roles);

  return (req, res, next) => {
    if (forbidIfNoUser(req, res)) {
      return;
    }

    const currentRole = getCurrentUserRole(req);

    if (!allowedRoles.includes(currentRole)) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé.',
      });
    }

    return next();
  };
};

const allowSelfOrRoles = (...roles) => {
  const allowedRoles = normalizeArray(roles);

  return (req, res, next) => {
    if (forbidIfNoUser(req, res)) {
      return;
    }

    const currentRole = getCurrentUserRole(req);
    const currentUserId = getCurrentUserId(req);
    const targetUserId = getTargetUserId(req);

    if (currentUserId && targetUserId && currentUserId === targetUserId) {
      return next();
    }

    if (allowedRoles.includes(currentRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Accès refusé.',
    });
  };
};

const requireAdminPermission = (...permissions) => {
  const requiredPermissions = normalizeArray(permissions);

  return (req, res, next) => {
    if (forbidIfNoUser(req, res)) {
      return;
    }

    const currentRole = getCurrentUserRole(req);

    if (currentRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès administrateur requis.',
      });
    }

    if (!hasAnyAdminPermission(req, requiredPermissions)) {
      return res.status(403).json({
        success: false,
        message: 'Permission administrateur insuffisante.',
      });
    }

    return next();
  };
};

const adminOnly = allowRoles('admin');
const driverOnly = allowRoles('livreur');
const restaurantOnly = allowRoles('restaurant');
const clientOnly = allowRoles('client');
const adminOrDriver = allowRoles('admin', 'livreur');
const adminOrRestaurant = allowRoles('admin', 'restaurant');
const adminOrClient = allowRoles('admin', 'client');
const restaurantOrDriver = allowRoles('restaurant', 'livreur');

module.exports = {
  allowRoles,
  allowSelfOrRoles,
  requireAdminPermission,
  adminOnly,
  driverOnly,
  restaurantOnly,
  clientOnly,
  adminOrDriver,
  adminOrRestaurant,
  adminOrClient,
  restaurantOrDriver,
  getCurrentUserRole,
  getCurrentUserId,
  getTargetUserId,
  hasAnyAdminPermission,
};