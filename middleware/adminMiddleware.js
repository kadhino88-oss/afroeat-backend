const normalizeString = (value) => String(value || '').trim().toLowerCase();

const normalizeArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter(Boolean);
};

const isAdminUser = (user) => {
  return normalizeString(user?.role) === 'admin';
};

const hasAdminPermission = (user, permission) => {
  const requiredPermission = normalizeString(permission);

  if (!requiredPermission) {
    return true;
  }

  const permissions = normalizeArray(user?.adminProfile?.permissions);
  return permissions.includes(requiredPermission);
};

const hasAnyAdminPermission = (user, permissions = []) => {
  const normalizedPermissions = normalizeArray(permissions);

  if (!normalizedPermissions.length) {
    return true;
  }

  return normalizedPermissions.some((permission) =>
    hasAdminPermission(user, permission)
  );
};

const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Non autorisé.',
    });
  }

  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Accès réservé à l’administrateur.',
    });
  }

  return next();
};

const requireAdminPermission = (...permissions) => {
  const normalizedPermissions = normalizeArray(permissions);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Non autorisé.',
      });
    }

    if (!isAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Accès réservé à l’administrateur.',
      });
    }

    if (!hasAnyAdminPermission(req.user, normalizedPermissions)) {
      return res.status(403).json({
        success: false,
        message: 'Permission administrateur insuffisante.',
      });
    }

    return next();
  };
};

module.exports = {
  adminOnly,
  requireAdminPermission,
  isAdminUser,
  hasAdminPermission,
  hasAnyAdminPermission,
};