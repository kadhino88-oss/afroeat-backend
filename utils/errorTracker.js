'use strict';

const crypto = require('crypto');

const clip = (value, max) => String(value == null ? '' : value).slice(0, max);

// Remplace les identifiants (ObjectId, nombres, jetons) pour regrouper les mêmes erreurs.
const normalizePath = (raw) =>
  clip(raw, 300)
    .split('?')[0]
    .replace(/[a-f0-9]{24}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/:token');

const firstStackLine = (stack) => {
  const line = String(stack || '').split('\n').find((l) => /at\s|@/.test(l)) || '';
  return line.trim().replace(/\?[^)\s]*/g, '').replace(/:\d+:\d+\)?$/, '');
};

const buildFingerprint = ({ source, message, path, stack }) =>
  crypto
    .createHash('sha1')
    .update([source, clip(message, 200).replace(/\d+/g, 'N'), normalizePath(path), firstStackLine(stack)].join('|'))
    .digest('hex');

const toEvent = (input = {}) => {
  const source = input.source === 'web' ? 'web' : 'api';
  const path = normalizePath(input.path);
  const message = clip(input.message || 'Erreur inconnue', 500);
  return {
    fingerprint: buildFingerprint({ source, message, path, stack: input.stack }),
    source,
    message,
    stack: clip(input.stack, 4000),
    method: clip(input.method, 10).toUpperCase(),
    path,
    status: Number(input.status) || 0,
    lastRequestId: clip(input.requestId, 80),
    lastUserRole: clip(input.userRole, 20),
    lastUserAgent: clip(input.userAgent, 200),
  };
};

// N'échoue jamais et n'attend pas une base déconnectée (tests, démarrage).
const recordError = async (input, { ErrorEvent, mongoose } = {}) => {
  try {
    const db = mongoose || require('mongoose');
    if (db.connection?.readyState !== 1) return false;
    const Model = ErrorEvent || require('../models/ErrorEvent');
    const event = toEvent(input);
    const now = new Date();
    const { fingerprint, source, message, path, method, ...latest } = event;
    await Model.updateOne(
      { fingerprint },
      {
        $setOnInsert: { fingerprint, source, message, path, method, firstSeenAt: now },
        $set: { ...latest, lastSeenAt: now, resolvedAt: null },
        $inc: { count: 1 },
      },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('errorTracker:', error.message);
    return false;
  }
};

// Capture toute réponse 5xx de l'API, y compris celles renvoyées par les try/catch des contrôleurs.
const captureServerErrors = (options = {}) => (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      res.locals.errorMessage = body.message || body.error || '';
    }
    return originalJson(body);
  };
  res.on('finish', () => {
    if (res.statusCode < 500) return;
    recordError(
      {
        source: 'api',
        message: res.locals.errorDetail || res.locals.errorMessage || `HTTP ${res.statusCode}`,
        stack: res.locals.errorStack || '',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        requestId: req.requestId,
        userRole: req.user?.role,
        userAgent: req.headers['user-agent'],
      },
      options
    );
  });
  next();
};

module.exports = { recordError, captureServerErrors, toEvent, normalizePath, buildFingerprint };
