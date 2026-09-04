/**
 * =========================================================
 * SECURITY MIDDLEWARE — AFROEAT
 * middleware/security.js
 *
 * Intègre dans server.js/app.js AVANT toutes les routes :
 *   const security = require('./middleware/security');
 *   security.apply(app);
 *
 * Dépendances à installer :
 *   npm install helmet express-rate-limit express-mongo-sanitize hpp cors
 * =========================================================
 */

const helmet           = require('helmet');
const rateLimit        = require('express-rate-limit');
const mongoSanitize    = require('express-mongo-sanitize');
const hpp              = require('hpp');
const cors             = require('cors');

// ─── CORS ─────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
  'https://afroeat.com',
  'https://app.afroeat.com',
  'https://www.afroeat.com',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow mobile apps (no origin) and listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS bloqué : origine non autorisée.'));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 86400, // Preflight cache 24h
};

// ─── Rate Limiters ────────────────────────────────────────

/** API générale : 200 req / 15 min par IP */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Trop de requêtes. Réessaie dans quelques minutes.' },
  skip: (req) => req.path === '/api/payments/webhook', // Webhook Stripe illimité
});

/** Auth : 10 tentatives / 15 min (brute-force protection) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Trop de tentatives. Compte temporairement bloqué.' },
  skipSuccessfulRequests: true, // Ne compte pas les succès
});

/** Création de commande : 30 / 15 min */
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Trop de commandes en cours. Réessaie dans quelques minutes.' },
});

/** Paiement : 20 / 15 min */
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Trop de tentatives de paiement.' },
});

/** Upload : 10 / heure */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Trop d\'uploads. Réessaie dans une heure.' },
});

// ─── Request ID ───────────────────────────────────────────
const requestId = (req, res, next) => {
  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

// ─── Logger sécurisé (sans données sensibles) ─────────────
const SENSITIVE_FIELDS = ['password', 'token', 'cardNumber', 'cvv', 'secret', 'authorization'];

const sanitizeLogBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  const safe = { ...body };
  SENSITIVE_FIELDS.forEach((field) => {
    if (safe[field]) safe[field] = '[REDACTED]';
  });
  return safe;
};

const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const log = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms (${req.requestId || '-'})`;
    console.log(log);
  });
  next();
};

// ─── Apply all security middleware ────────────────────────
const apply = (app) => {
  // 1. CORS
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // 2. Helmet (headers sécurisés)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", 'https://js.stripe.com'],
        frameSrc:   ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
        connectSrc: ["'self'", 'https://api.stripe.com'],
        imgSrc:     ["'self'", 'data:', 'https:', 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // 3. Request ID
  app.use(requestId);

  // 4. Logger
  app.use(requestLogger);

  // 5. Rate limiting global
  app.use('/api/', globalLimiter);

  // 6. Rate limiting spécifique
  app.use('/api/users/login',    authLimiter);
  app.use('/api/users/register', authLimiter);
  app.use('/api/orders',         orderLimiter);
  app.use('/api/payments',       paymentLimiter);
  app.use('/api/uploads',        uploadLimiter);

  // 7. NoSQL Injection prevention
  app.use(mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      console.warn(`⚠️ NoSQL injection bloquée: ${key} (${req.requestId})`);
    },
  }));

  // 8. HTTP Parameter Pollution prevention
  app.use(hpp({
    whitelist: ['sort', 'fields', 'page', 'limit', 'cuisine', 'city'],
  }));
};

module.exports = {
  apply,
  authLimiter,
  orderLimiter,
  paymentLimiter,
  uploadLimiter,
  corsOptions,
};
