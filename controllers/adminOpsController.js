const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const AdminAuditLog = require('../models/AdminAuditLog');

const MS_IN_24_HOURS = 24 * 60 * 60 * 1000;
const MS_IN_7_DAYS = 7 * 24 * 60 * 60 * 1000;

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const percentage = (value, total) => {
  const safeValue = normalizeNumber(value, 0);
  const safeTotal = normalizeNumber(total, 0);

  if (safeTotal <= 0) {
    return 0;
  }

  return Number(((safeValue / safeTotal) * 100).toFixed(2));
};

const ensureAdmin = (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      message: 'Accès refusé.',
    });
    return false;
  }

  return true;
};

const sendServerError = (res, error, contextLabel = 'ADMIN OPS ERROR') => {
  console.error(`${contextLabel} =>`, error);

  return res.status(500).json({
    success: false,
    message: error?.message || 'Erreur serveur.',
  });
};

const buildHealthStatus = ({
  suspendedUsers,
  pendingUsers,
  pendingOrders,
  unassignedOrders,
  unpaidOrders,
  recentAuditLogs24h,
  cancelledOrders7d,
}) => {
  let healthStatus = 'healthy';

  const criticalConditions = [
    pendingOrders >= 100,
    unassignedOrders >= 50,
    unpaidOrders >= 100,
    suspendedUsers >= 50,
  ];

  const warningConditions = [
    suspendedUsers >= 20,
    pendingUsers >= 30,
    unassignedOrders >= 20,
    unpaidOrders >= 50,
    recentAuditLogs24h >= 250,
    cancelledOrders7d >= 50,
  ];

  if (criticalConditions.some(Boolean)) {
    healthStatus = 'critical';
  } else if (warningConditions.some(Boolean)) {
    healthStatus = 'warning';
  }

  return healthStatus;
};

const buildHealthFlags = ({
  suspendedUsers,
  pendingUsers,
  pendingOrders,
  unassignedOrders,
  unpaidOrders,
  recentAuditLogs24h,
  cancelledOrders7d,
}) => {
  const flags = [];

  if (pendingOrders >= 100) {
    flags.push({
      level: 'critical',
      code: 'HIGH_PENDING_ORDERS',
      message: 'Le volume de commandes en attente est critique.',
      value: pendingOrders,
    });
  } else if (pendingOrders >= 40) {
    flags.push({
      level: 'warning',
      code: 'ELEVATED_PENDING_ORDERS',
      message: 'Le volume de commandes en attente est élevé.',
      value: pendingOrders,
    });
  }

  if (unassignedOrders >= 50) {
    flags.push({
      level: 'critical',
      code: 'HIGH_UNASSIGNED_ORDERS',
      message: 'Le nombre de commandes sans livreur est critique.',
      value: unassignedOrders,
    });
  } else if (unassignedOrders >= 20) {
    flags.push({
      level: 'warning',
      code: 'ELEVATED_UNASSIGNED_ORDERS',
      message: 'Le nombre de commandes sans livreur est élevé.',
      value: unassignedOrders,
    });
  }

  if (unpaidOrders >= 100) {
    flags.push({
      level: 'critical',
      code: 'HIGH_UNPAID_ORDERS',
      message: 'Le volume de commandes impayées est critique.',
      value: unpaidOrders,
    });
  } else if (unpaidOrders >= 50) {
    flags.push({
      level: 'warning',
      code: 'ELEVATED_UNPAID_ORDERS',
      message: 'Le volume de commandes impayées est élevé.',
      value: unpaidOrders,
    });
  }

  if (suspendedUsers >= 50) {
    flags.push({
      level: 'critical',
      code: 'HIGH_SUSPENDED_USERS',
      message: 'Le nombre de comptes suspendus est critique.',
      value: suspendedUsers,
    });
  } else if (suspendedUsers >= 20) {
    flags.push({
      level: 'warning',
      code: 'ELEVATED_SUSPENDED_USERS',
      message: 'Le nombre de comptes suspendus est élevé.',
      value: suspendedUsers,
    });
  }

  if (pendingUsers >= 30) {
    flags.push({
      level: 'warning',
      code: 'ELEVATED_PENDING_USERS',
      message: 'Le nombre de comptes en attente de vérification est élevé.',
      value: pendingUsers,
    });
  }

  if (recentAuditLogs24h >= 250) {
    flags.push({
      level: 'warning',
      code: 'HIGH_AUDIT_ACTIVITY',
      message: 'Le volume d’activité admin sur 24h est inhabituellement élevé.',
      value: recentAuditLogs24h,
    });
  }

  if (cancelledOrders7d >= 50) {
    flags.push({
      level: 'warning',
      code: 'HIGH_CANCELLED_ORDERS_7D',
      message: 'Le volume de commandes annulées sur 7 jours est élevé.',
      value: cancelledOrders7d,
    });
  }

  return flags;
};

const getAdminOpsOverview = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const now = new Date();
    const last24Hours = new Date(Date.now() - MS_IN_24_HOURS);
    const last7Days = new Date(Date.now() - MS_IN_7_DAYS);

    const [
      totalUsers,
      totalRestaurants,
      totalDrivers,
      totalAdmins,
      totalOrders,

      activeUsers,
      suspendedUsers,
      pendingUsers,
      rejectedUsers,

      activeRestaurantsOwners,
      activeDriversAccounts,

      pendingOrders,
      preparingOrders,
      deliveringOrders,
      deliveredOrders,
      cancelledOrders,
      cancelledOrders7d,
      unassignedOrders,

      unpaidOrders,
      paidOrders,

      recentAuditLogs24h,
      recentAuditLogs7d,

      newUsers7d,
      newRestaurants7d,
      newOrders24h,
      newOrders7d,
    ] = await Promise.all([
      User.countDocuments({}),
      Restaurant.countDocuments({}),
      User.countDocuments({ role: 'livreur' }),
      User.countDocuments({ role: 'admin' }),
      Order.countDocuments({}),

      User.countDocuments({ accountStatus: 'active' }),
      User.countDocuments({ accountStatus: 'suspended' }),
      User.countDocuments({ accountStatus: 'pending_verification' }),
      User.countDocuments({ accountStatus: 'rejected' }),

      User.countDocuments({
        role: 'restaurant',
        accountStatus: 'active',
      }),
      User.countDocuments({
        role: 'livreur',
        accountStatus: 'active',
      }),

      Order.countDocuments({ status: 'En attente' }),
      Order.countDocuments({ status: 'En préparation' }),
      Order.countDocuments({ status: 'En livraison' }),
      Order.countDocuments({ status: 'Livrée' }),
      Order.countDocuments({ status: 'Annulée' }),
      Order.countDocuments({
        status: 'Annulée',
        createdAt: { $gte: last7Days },
      }),
      Order.countDocuments({
        $or: [{ deliveryPerson: null }, { deliveryPerson: { $exists: false } }],
      }),

      Order.countDocuments({
        paymentStatus: { $in: ['Non payé', 'unpaid', 'UNPAID'] },
      }),
      Order.countDocuments({
        paymentStatus: { $in: ['Payé', 'paid', 'PAID'] },
      }),

      AdminAuditLog.countDocuments({
        createdAt: { $gte: last24Hours },
      }),
      AdminAuditLog.countDocuments({
        createdAt: { $gte: last7Days },
      }),

      User.countDocuments({
        createdAt: { $gte: last7Days },
      }),
      Restaurant.countDocuments({
        createdAt: { $gte: last7Days },
      }),
      Order.countDocuments({
        createdAt: { $gte: last24Hours },
      }),
      Order.countDocuments({
        createdAt: { $gte: last7Days },
      }),
    ]);

    const healthStatus = buildHealthStatus({
      suspendedUsers,
      pendingUsers,
      pendingOrders,
      unassignedOrders,
      unpaidOrders,
      recentAuditLogs24h,
      cancelledOrders7d,
    });

    const healthFlags = buildHealthFlags({
      suspendedUsers,
      pendingUsers,
      pendingOrders,
      unassignedOrders,
      unpaidOrders,
      recentAuditLogs24h,
      cancelledOrders7d,
    });

    const userRates = {
      activeRate: percentage(activeUsers, totalUsers),
      suspendedRate: percentage(suspendedUsers, totalUsers),
      pendingRate: percentage(pendingUsers, totalUsers),
      rejectedRate: percentage(rejectedUsers, totalUsers),
    };

    const orderRates = {
      pendingRate: percentage(pendingOrders, totalOrders),
      preparingRate: percentage(preparingOrders, totalOrders),
      deliveringRate: percentage(deliveringOrders, totalOrders),
      deliveredRate: percentage(deliveredOrders, totalOrders),
      cancelledRate: percentage(cancelledOrders, totalOrders),
      unpaidRate: percentage(unpaidOrders, totalOrders),
      paidRate: percentage(paidOrders, totalOrders),
      unassignedRate: percentage(unassignedOrders, totalOrders),
    };

    const growth = {
      users7d: newUsers7d,
      restaurants7d: newRestaurants7d,
      orders24h: newOrders24h,
      orders7d: newOrders7d,
    };

    const coverage = {
      activeRestaurantsOwnersRate: percentage(activeRestaurantsOwners, totalRestaurants),
      activeDriversAccountsRate: percentage(activeDriversAccounts, totalDrivers),
    };

    return res.status(200).json({
      success: true,
      ops: {
        system: {
          healthStatus,
          generatedAt: now,
          monitoringWindow: {
            last24Hours,
            last7Days,
          },
          flags: healthFlags,
        },
        entities: {
          totalUsers,
          totalRestaurants,
          totalDrivers,
          totalAdmins,
          activeUsers,
          suspendedUsers,
          pendingUsers,
          rejectedUsers,
          activeRestaurantsOwners,
          activeDriversAccounts,
          newUsers7d,
          newRestaurants7d,
          rates: userRates,
          coverage,
        },
        orders: {
          totalOrders,
          pendingOrders,
          preparingOrders,
          deliveringOrders,
          deliveredOrders,
          cancelledOrders,
          cancelledOrders7d,
          unassignedOrders,
          unpaidOrders,
          paidOrders,
          newOrders24h,
          newOrders7d,
          rates: orderRates,
        },
        audit: {
          recentAuditLogs24h,
          recentAuditLogs7d,
        },
        growth,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN OPS OVERVIEW ERROR');
  }
};

module.exports = {
  getAdminOpsOverview,
};