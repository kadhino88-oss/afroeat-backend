'use strict';

/**
 * Verrou d'origine pour l'administration.
 *
 * Quand ADMIN_WEB_ORIGINS est renseignée (ex. https://afroeat-admin.vercel.app), un compte
 * administrateur ne peut se connecter et utiliser l'API d'administration que depuis ces
 * adresses : la session admin n'existe donc jamais sur le site public.
 * C'est une barrière supplémentaire ; le contrôle du rôle côté serveur reste la vraie protection.
 * Sans la variable (environnements de test et de développement), rien n'est restreint.
 */
const listAdminOrigins = (env = process.env) =>
  String(env.ADMIN_WEB_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const isAdminOriginAllowed = (origin, env = process.env) => {
  const allowed = listAdminOrigins(env);
  if (!allowed.length) return true;
  return allowed.includes(String(origin || '').trim().replace(/\/+$/, ''));
};

/** À placer sur les routes d'administration, après l'authentification. */
const requireAdminOrigin = (req, res, next) => {
  if (isAdminOriginAllowed(req.headers?.origin)) return next();
  return res.status(403).json({
    success: false,
    code: 'ADMIN_ORIGIN_REQUIRED',
    message: 'Accès refusé.',
  });
};

module.exports = { listAdminOrigins, isAdminOriginAllowed, requireAdminOrigin };
