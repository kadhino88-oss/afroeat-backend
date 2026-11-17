'use strict';

const ErrorEvent = require('../models/ErrorEvent');
const { recordError } = require('../utils/errorTracker');

// Erreurs JavaScript remontées par le site (sans authentification, limitées en débit).
const reportClientError = async (req, res) => {
  const { message, stack, path } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, message: 'Message requis.' });
  }
  await recordError({
    source: 'web',
    message,
    stack: typeof stack === 'string' ? stack : '',
    path: typeof path === 'string' ? path : '',
    userAgent: req.headers['user-agent'],
    requestId: req.requestId,
  });
  return res.status(202).json({ success: true });
};

const listErrors = async (req, res) => {
  try {
    const showResolved = req.query.resolved === 'true';
    const filter = showResolved ? {} : { resolvedAt: null };
    const errors = await ErrorEvent.find(filter).sort({ lastSeenAt: -1 }).limit(100).lean();
    const [open, last24h] = await Promise.all([
      ErrorEvent.countDocuments({ resolvedAt: null }),
      ErrorEvent.countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 86400000) } }),
    ]);
    return res.json({ success: true, errors, stats: { open, last24h } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Impossible de charger les erreurs.' });
  }
};

const resolveError = async (req, res) => {
  try {
    const updated = await ErrorEvent.findByIdAndUpdate(
      req.params.id,
      { $set: { resolvedAt: new Date() } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ success: false, message: 'Erreur introuvable.' });
    return res.json({ success: true, error: updated });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Identifiant invalide.' });
  }
};

module.exports = { reportClientError, listErrors, resolveError };
