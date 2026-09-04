const mongoose = require('mongoose');
const AdminAuditLog = require('../models/AdminAuditLog');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ALLOWED_TARGET_TYPES = [
  'user',
  'restaurant',
  'driver',
  'order',
  'system',
  'other',
];

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

const sendServerError = (res, error, contextLabel = 'ADMIN AUDIT ERROR') => {
  console.error(`${contextLabel} =>`, error);

  return res.status(500).json({
    success: false,
    message: error?.message || 'Erreur serveur.',
  });
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

const buildAuditFilter = (query = {}) => {
  const filter = {};

  const action = normalizeString(query.action);
  const targetType = normalizeLowerString(query.targetType);
  const adminId = normalizeString(query.adminId);
  const search = normalizeString(query.search);
  const createdAtRange = buildDateRangeFilter(query);

  if (action) {
    filter.action = { $regex: escapeRegex(action), $options: 'i' };
  }

  if (targetType && ALLOWED_TARGET_TYPES.includes(targetType)) {
    filter.targetType = targetType;
  }

  if (adminId && isValidObjectId(adminId)) {
    filter.admin = adminId;
  }

  if (createdAtRange) {
    filter.createdAt = createdAtRange;
  }

  if (search) {
    const safeSearch = escapeRegex(search);

    filter.$or = [
      { targetLabel: { $regex: safeSearch, $options: 'i' } },
      { details: { $regex: safeSearch, $options: 'i' } },
      { action: { $regex: safeSearch, $options: 'i' } },
      { ipAddress: { $regex: safeSearch, $options: 'i' } },
      { userAgent: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  return filter;
};

const getAuditSortConfig = (sort) => {
  if (sort === 'oldest') {
    return { createdAt: 1, _id: 1 };
  }

  return { createdAt: -1, _id: -1 };
};

const sanitizeTargetType = (value) => {
  const normalized = normalizeLowerString(value);

  if (!normalized || !ALLOWED_TARGET_TYPES.includes(normalized)) {
    return 'other';
  }

  return normalized;
};

const sanitizeMetadata = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'object') {
    return value;
  }

  return {
    value: String(value),
  };
};

const sanitizeTargetId = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (isValidObjectId(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
};

const getAuditLogs = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { page, limit, skip } = buildPagination(req.query);
    const sort = parseSort(req.query.sort, ['recent', 'oldest']);
    const filter = buildAuditFilter(req.query);

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(filter)
        .populate('admin', '_id name email role')
        .sort(getAuditSortConfig(sort))
        .skip(skip)
        .limit(limit),
      AdminAuditLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      logs,
      pagination: buildPaginationMeta({
        total,
        page,
        limit,
        count: logs.length,
      }),
      total,
      count: logs.length,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      filters: {
        action: normalizeString(req.query.action) || null,
        targetType:
          ALLOWED_TARGET_TYPES.includes(normalizeLowerString(req.query.targetType))
            ? normalizeLowerString(req.query.targetType)
            : null,
        adminId:
          isValidObjectId(normalizeString(req.query.adminId))
            ? normalizeString(req.query.adminId)
            : null,
        search: normalizeString(req.query.search) || null,
        sort,
        from: normalizeString(req.query.from) || null,
        to: normalizeString(req.query.to) || null,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN AUDIT GET LOGS ERROR');
  }
};

const getAuditLogById = async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID de journal invalide.',
      });
    }

    const log = await AdminAuditLog.findById(id).populate(
      'admin',
      '_id name email role'
    );

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Journal introuvable.',
      });
    }

    return res.status(200).json({
      success: true,
      log,
    });
  } catch (error) {
    return sendServerError(res, error, 'ADMIN AUDIT GET LOG BY ID ERROR');
  }
};

const createAuditLog = async ({
  adminId,
  action,
  targetType = 'other',
  targetId = null,
  targetLabel = '',
  details = '',
  metadata = null,
  ipAddress = '',
  userAgent = '',
}) => {
  try {
    const normalizedAction = normalizeString(action);

    if (!adminId || !normalizedAction) {
      return null;
    }

    const log = await AdminAuditLog.create({
      admin: adminId,
      action: normalizedAction,
      targetType: sanitizeTargetType(targetType),
      targetId: sanitizeTargetId(targetId),
      targetLabel: normalizeString(targetLabel),
      details: normalizeString(details),
      metadata: sanitizeMetadata(metadata),
      ipAddress: normalizeString(ipAddress),
      userAgent: normalizeString(userAgent),
    });

    return log;
  } catch (error) {
    console.error('ADMIN AUDIT CREATE LOG ERROR =>', error);
    return null;
  }
};

module.exports = {
  getAuditLogs,
  getAuditLogById,
  createAuditLog,
};