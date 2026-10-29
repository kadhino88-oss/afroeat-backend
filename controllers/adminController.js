const mongoose = require('mongoose');

const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const { createAuditLog } = require('./adminAuditController');
const { validateCourierVerificationUpdate } = require('../utils/courierAssignmentEligibility');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ALLOWED_USER_STATUSES = [
  'pending_verification',
  'active',
  'suspended',
  'rejected',
];

const ALLOWED_USER_ROLES = ['client', 'restaurant', 'livreur', 'admin'];

const normalizeString = (value) => String(value || '').trim();

const normalizeLowerString = (value) => normalizeString(value).toLowerCase();

const normalizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const escapeRegex = (value = '') =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseSort = (value, allowed = ['recent']) => {
  const sort = normalizeLowerString(value);

  if (allowed.includes(sort)) {
    return sort;
  }

  return 'recent';
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const buildPagination = (query = {}) => {
  const page = normalizePositiveInteger(query.page, DEFAULT_PAGE);
  const limit = Math.min(
    normalizePositiveInteger(query.limit, DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const getRequestIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    ''
  );
};

const getRequestUserAgent = (req) => normalizeString(req.headers['user-agent']);

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

const sendServerError = (res, error, contextLabel = 'ADMIN ERROR') => {
  console.error(`${contextLabel} =>`, error);

  return res.status(500).json({
    success: false,
    message: error?.message || 'Erreur serveur.',
  });
};

const buildSortConfig = (sort) => {
  switch (sort) {
    case 'oldest':
      return { createdAt: 1, _id: 1 };
    case 'name':
      return { name: 1, _id: 1 };
    default:
      return { createdAt: -1, _id: -1 };
  }
};

const buildOrderSortConfig = (sort) => {
  if (sort === 'oldest') {
    return { createdAt: 1, _id: 1 };
  }

  return { createdAt: -1, _id: -1 };
};

const buildDateRangeFilter = (query = {}) => {
  const from = normalizeString(query.from);
  const to = normalizeString(query.to);

  if (!from && !to) {
    return null;
  }

  const dateFilter = {};
  let hasValidDate = false;

  if (from) {
    const fromDate = new Date(from);

    if (!Number.isNaN(fromDate.getTime())) {
      fromDate.setHours(0, 0, 0, 0);
      dateFilter.$gte = fromDate;
      hasValidDate = true;
    }
  }

  if (to) {
    const toDate = new Date(to);

    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = toDate;
      hasValidDate = true;
    }
  }

  return hasValidDate ? dateFilter : null;
};

const buildPaginationMeta = ({ total, page, limit, count }) => {
  const pages = Math.max(Math.ceil(total / limit), 1);

  return {
    page,
    limit,
    total,
    count,
    pages,
    hasPrevPage: page > 1,
    hasNextPage: page < pages,
  };
};

const buildUserFilter = (query = {}) => {
  const filter = {};

  const role = normalizeLowerString(query.role);
  const status = normalizeLowerString(query.status);
  const search = normalizeString(query.search);
  const createdAtRange = buildDateRangeFilter(query);

  if (role && ALLOWED_USER_ROLES.includes(role)) {
    filter.role = role;
  }

  if (status && ALLOWED_USER_STATUSES.includes(status)) {
    filter.accountStatus = status;
  }

  if (createdAtRange) {
    filter.createdAt = createdAtRange;
  }

  if (search) {
    const safeSearch = escapeRegex(search);

    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } },
      { phone: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  return filter;
};

const buildRestaurantFilter = (query = {}) => {
  const filter = {};

  const cuisine = normalizeString(query.cuisine);
  const city = normalizeString(query.city);
  const country = normalizeString(query.country);
  const search = normalizeString(query.search);
  const ownerId = normalizeString(query.ownerId);
  const createdAtRange = buildDateRangeFilter(query);

  if (cuisine) {
    filter.cuisine = { $regex: escapeRegex(cuisine), $options: 'i' };
  }

  if (city) {
    filter.city = { $regex: escapeRegex(city), $options: 'i' };
  }

  if (country) {
    filter.country = { $regex: escapeRegex(country), $options: 'i' };
  }

  if (ownerId && isValidObjectId(ownerId)) {
    filter.owner = ownerId;
  }

  if (createdAtRange) {
    filter.createdAt = createdAtRange;
  }

  if (search) {
    const safeSearch = escapeRegex(search);

    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { cuisine: { $regex: safeSearch, $options: 'i' } },
      { address: { $regex: safeSearch, $options: 'i' } },
      { city: { $regex: safeSearch, $options: 'i' } },
      { country: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  return filter;
};

const buildDriverFilter = (query = {}) => {
  const filter = { role: 'livreur' };

  const status = normalizeLowerString(query.status);
  const search = normalizeString(query.search);
  const createdAtRange = buildDateRangeFilter(query);

  if (status && ALLOWED_USER_STATUSES.includes(status)) {
    filter.accountStatus = status;
  }

  if (createdAtRange) {
    filter.createdAt = createdAtRange;
  }

  if (search) {
    const safeSearch = escapeRegex(search);

    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } },
      { phone: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  return filter;
};

const buildOrderFilter = (query = {}) => {
  const filter = {};

  const status = normalizeString(query.status);
  const paymentStatus = normalizeString(query.paymentStatus);
  const restaurantId = normalizeString(query.restaurantId);
  const userId = normalizeString(query.userId);
  const deliveryPersonId = normalizeString(query.deliveryPersonId);
  const createdAtRange = buildDateRangeFilter(query);

  if (status) {
    filter.status = status;
  }

  if (paymentStatus) {
    filter.paymentStatus = paymentStatus;
  }

  if (restaurantId && isValidObjectId(restaurantId)) {
    filter.restaurant = restaurantId;
  }

  if (userId && isValidObjectId(userId)) {
    filter.user = userId;
  }

  if (deliveryPersonId && isValidObjectId(deliveryPersonId)) {
    filter.deliveryPerson = deliveryPersonId;
  }

  if (createdAtRange) {
    filter.createdAt = createdAtRange;
  }

  return filter;
};

const safeCreateAuditLog = async ({
  req,
  action,
  targetType,
  targetId,
  targetLabel,
  details,
  metadata = {},
}) => {
  try {
    if (!req?.user?._id || typeof createAuditLog !== 'function') {
      return;
    }

    await createAuditLog({
      adminId: req.user._id,
      action,
      targetType,
      targetId,
      targetLabel,
      details,
      metadata,
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });
  } catch (auditError) {
    console.error('ADMIN AUDIT LOG ERROR =>', auditError);
  }
};

const getAdminDashboard = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalClients,
      totalRestaurantsUsers,
      totalDrivers,
      totalAdmins,
      activeUsers,
      suspendedUsers,
      pendingUsers,
      rejectedUsers,
      totalRestaurants,
      totalOrders,
      pendingOrders,
      deliveringOrders,
      deliveredOrders,
      cancelledOrders,
      paidOrders,
      unpaidOrders,
      recentUsers,
      recentRestaurants,
      recentOrders,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'client' }),
      User.countDocuments({ role: 'restaurant' }),
      User.countDocuments({ role: 'livreur' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ accountStatus: 'active' }),
      User.countDocuments({ accountStatus: 'suspended' }),
      User.countDocuments({ accountStatus: 'pending_verification' }),
      User.countDocuments({ accountStatus: 'rejected' }),
      Restaurant.countDocuments({}),
      Order.countDocuments({}),
      Order.countDocuments({ status: 'En attente' }),
      Order.countDocuments({ status: 'En livraison' }),
      Order.countDocuments({ status: 'Livrée' }),
      Order.countDocuments({ status: 'Annulée' }),
      Order.countDocuments({
        paymentStatus: { $in: ['paid', 'Payé', 'payé'] },
      }),
      Order.countDocuments({
        paymentStatus: { $in: ['unpaid', 'Non payé', 'non payé'] },
      }),
      User.countDocuments({
        createdAt: { $gte: sevenDaysAgo },
      }),
      Restaurant.countDocuments({
        createdAt: { $gte: sevenDaysAgo },
      }),
      Order.countDocuments({
        createdAt: { $gte: sevenDaysAgo },
      }),
    ]);

    return res.status(200).json({
      success: true,
      dashboard: {
        users: {
          total: totalUsers,
          clients: totalClients,
          restaurants: totalRestaurantsUsers,
          drivers: totalDrivers,
          admins: totalAdmins,
          active: activeUsers,
          suspended: suspendedUsers,
          pending: pendingUsers,
          rejected: rejectedUsers,
          recent7d: recentUsers,
        },
        restaurants: {
          total: totalRestaurants,
          recent7d: recentRestaurants,
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          delivering: deliveringOrders,
          delivered: deliveredOrders,
          cancelled: cancelledOrders,
          paid: paidOrders,
          unpaid: unpaidOrders,
          recent7d: recentOrders,
        },
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN DASHBOARD ERROR');
  }
};

const getAdminUsers = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page, limit, skip } = buildPagination(req.query);
    const sort = parseSort(req.query.sort, ['recent', 'oldest', 'name']);
    const filter = buildUserFilter(req.query);

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort(buildSortConfig(sort))
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      users,
      pagination: buildPaginationMeta({
        total,
        page,
        limit,
        count: users.length,
      }),
      total,
      count: users.length,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      filters: {
        role: normalizeLowerString(req.query.role) || null,
        status: normalizeLowerString(req.query.status) || null,
        search: normalizeString(req.query.search) || null,
        sort,
        from: normalizeString(req.query.from) || null,
        to: normalizeString(req.query.to) || null,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET USERS ERROR');
  }
};

const getAdminUserById = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID utilisateur invalide.',
      });
    }

    const user = await User.findById(id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET USER BY ID ERROR');
  }
};

const updateAdminUserStatus = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;
    const nextStatus = normalizeLowerString(req.body?.accountStatus);

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID utilisateur invalide.',
      });
    }

    if (!nextStatus || !ALLOWED_USER_STATUSES.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Statut utilisateur invalide.',
      });
    }

    const existingUser = await User.findById(id).select('-password');

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable.',
      });
    }

    if (String(existingUser._id) === String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Impossible de modifier votre propre statut admin.',
      });
    }

    if (existingUser.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Impossible de modifier le statut d’un compte admin.',
      });
    }

    const previousStatus = normalizeLowerString(existingUser.accountStatus);

    if (previousStatus === nextStatus) {
      return res.status(200).json({
        success: true,
        message: 'Aucun changement nécessaire.',
        user: existingUser,
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { accountStatus: nextStatus },
      { new: true, runValidators: true }
    ).select('-password');

    await safeCreateAuditLog({
      req,
      action: 'update_user_status',
      targetType:
        updatedUser?.role === 'livreur'
          ? 'driver'
          : updatedUser?.role === 'restaurant'
            ? 'restaurant'
            : 'user',
      targetId: updatedUser?._id || id,
      targetLabel: `${normalizeString(updatedUser?.name)} <${normalizeString(
        updatedUser?.email
      )}>`,
      details: `Statut modifié de "${previousStatus}" vers "${nextStatus}"`,
      metadata: {
        previousStatus,
        nextStatus,
        targetRole: normalizeString(updatedUser?.role),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Statut utilisateur mis à jour avec succès.',
      user: updatedUser,
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN UPDATE USER STATUS ERROR');
  }
};

const updateAdminUserVerification = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_USER_ID',
        message: 'ID utilisateur invalide.',
      });
    }

    const decision = validateCourierVerificationUpdate(req.body);
    if (!decision.ok) {
      return res.status(decision.status).json({
        success: false,
        code: decision.code,
        message: decision.message,
      });
    }

    const existingUser = await User.findById(id).select(
      '_id name email role accountStatus isIdentityVerified isWorkAuthorized isAvailable'
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'Utilisateur introuvable.',
      });
    }

    if (existingUser.role !== 'livreur') {
      return res.status(400).json({
        success: false,
        code: 'COURIER_VERIFICATION_ONLY',
        message: 'Cette action est réservée aux comptes livreur.',
      });
    }

    const previousIdentityVerified = existingUser.isIdentityVerified === true;
    const previousWorkAuthorized = existingUser.isWorkAuthorized === true;

    if (
      previousIdentityVerified === decision.isIdentityVerified &&
      previousWorkAuthorized === decision.isWorkAuthorized
    ) {
      return res.status(200).json({
        success: true,
        message: 'Aucun changement nécessaire.',
        user: {
          _id: existingUser._id,
          name: existingUser.name || '',
          email: existingUser.email || '',
          role: existingUser.role,
          accountStatus: existingUser.accountStatus,
          isIdentityVerified: previousIdentityVerified,
          isWorkAuthorized: previousWorkAuthorized,
          isAvailable: existingUser.isAvailable === true,
        },
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      {
        isIdentityVerified: decision.isIdentityVerified,
        isWorkAuthorized: decision.isWorkAuthorized,
      },
      { new: true, runValidators: true }
    ).select(
      '_id name email role accountStatus isIdentityVerified isWorkAuthorized isAvailable'
    );

    await safeCreateAuditLog({
      req,
      action: 'update_courier_verification',
      targetType: 'driver',
      targetId: updatedUser?._id || id,
      targetLabel: `${normalizeString(updatedUser?.name)} <${normalizeString(updatedUser?.email)}>`,
      details: decision.note || 'Vérification du livreur révoquée.',
      metadata: {
        previousIdentityVerified,
        previousWorkAuthorized,
        isIdentityVerified: decision.isIdentityVerified,
        isWorkAuthorized: decision.isWorkAuthorized,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Vérification du livreur enregistrée.',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name || '',
        email: updatedUser.email || '',
        role: updatedUser.role,
        accountStatus: updatedUser.accountStatus,
        isIdentityVerified: updatedUser.isIdentityVerified === true,
        isWorkAuthorized: updatedUser.isWorkAuthorized === true,
        isAvailable: updatedUser.isAvailable === true,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN UPDATE COURIER VERIFICATION ERROR');
  }
};

const getAdminRestaurants = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page, limit, skip } = buildPagination(req.query);
    const sort = parseSort(req.query.sort, ['recent', 'oldest', 'name']);
    const filter = buildRestaurantFilter(req.query);

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .populate(
          'owner',
          '_id name email phone role accountStatus isIdentityVerified isWorkAuthorized'
        )
        .sort(buildSortConfig(sort))
        .skip(skip)
        .limit(limit),
      Restaurant.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      restaurants,
      pagination: buildPaginationMeta({
        total,
        page,
        limit,
        count: restaurants.length,
      }),
      total,
      count: restaurants.length,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      filters: {
        cuisine: normalizeString(req.query.cuisine) || null,
        city: normalizeString(req.query.city) || null,
        country: normalizeString(req.query.country) || null,
        ownerId: normalizeString(req.query.ownerId) || null,
        search: normalizeString(req.query.search) || null,
        sort,
        from: normalizeString(req.query.from) || null,
        to: normalizeString(req.query.to) || null,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET RESTAURANTS ERROR');
  }
};

const getAdminRestaurantById = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID restaurant invalide.',
      });
    }

    const restaurant = await Restaurant.findById(id).populate(
      'owner',
      '_id name email phone role accountStatus isIdentityVerified isWorkAuthorized'
    );

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      restaurant,
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET RESTAURANT BY ID ERROR');
  }
};

const getAdminDrivers = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page, limit, skip } = buildPagination(req.query);
    const sort = parseSort(req.query.sort, ['recent', 'oldest', 'name']);
    const filter = buildDriverFilter(req.query);

    const [drivers, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort(buildSortConfig(sort))
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      drivers,
      pagination: buildPaginationMeta({
        total,
        page,
        limit,
        count: drivers.length,
      }),
      total,
      count: drivers.length,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      filters: {
        status: normalizeLowerString(req.query.status) || null,
        search: normalizeString(req.query.search) || null,
        sort,
        from: normalizeString(req.query.from) || null,
        to: normalizeString(req.query.to) || null,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET DRIVERS ERROR');
  }
};

const getAdminOrders = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page, limit, skip } = buildPagination(req.query);
    const sort = parseSort(req.query.sort, ['recent', 'oldest']);
    const filter = buildOrderFilter(req.query);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('user', '_id name email role')
        .populate('restaurant', '_id name cuisine image coverImage owner')
        .populate('deliveryPerson', '_id name email role')
        .sort(buildOrderSortConfig(sort))
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      orders,
      pagination: buildPaginationMeta({
        total,
        page,
        limit,
        count: orders.length,
      }),
      total,
      count: orders.length,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      filters: {
        status: normalizeString(req.query.status) || null,
        paymentStatus: normalizeString(req.query.paymentStatus) || null,
        restaurantId:
          isValidObjectId(normalizeString(req.query.restaurantId))
            ? normalizeString(req.query.restaurantId)
            : null,
        userId:
          isValidObjectId(normalizeString(req.query.userId))
            ? normalizeString(req.query.userId)
            : null,
        deliveryPersonId:
          isValidObjectId(normalizeString(req.query.deliveryPersonId))
            ? normalizeString(req.query.deliveryPersonId)
            : null,
        sort,
        from: normalizeString(req.query.from) || null,
        to: normalizeString(req.query.to) || null,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET ORDERS ERROR');
  }
};

const getAdminOrderById = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID commande invalide.',
      });
    }

    const order = await Order.findById(id)
      .populate('user', '_id name email role')
      .populate('restaurant', '_id name cuisine image coverImage owner')
      .populate('deliveryPerson', '_id name email role');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN GET ORDER BY ID ERROR');
  }
};

module.exports = {
  getAdminDashboard,
  getAdminUsers,
  getAdminUserById,
  updateAdminUserStatus,
  updateAdminUserVerification,
  getAdminRestaurants,
  getAdminRestaurantById,
  getAdminDrivers,
  getAdminOrders,
  getAdminOrderById,
};