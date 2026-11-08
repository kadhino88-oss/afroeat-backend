const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGO_URI = String(process.env.MONGO_URI || '').trim();

const isProduction = NODE_ENV === 'production';
const serverStartedAt = Date.now();

const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

let isShuttingDown = false;
let httpServer = null;

const getMongoStateLabel = (state) => {
  switch (state) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
};

const buildRequestId = () =>
  `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const maskMongoUriForLogs = (uri) => {
  try {
    return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  } catch {
    return 'mongodb://***';
  }
};

if (!MONGO_URI) {
  console.error("❌ MONGO_URI manquant dans les variables d'environnement");
  process.exit(1);
}

const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const isPlaceholderJwtSecret = /^(replace|change[-_ ]?me|placeholder|example)/i.test(
  JWT_SECRET
);

if (!JWT_SECRET || JWT_SECRET.length < 32 || isPlaceholderJwtSecret) {
  console.error(
    '❌ JWT_SECRET manquant, trop faible ou encore défini sur une valeur de remplacement'
  );
  process.exit(1);
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY manquant — paiements désactivés');
}

process.on('uncaughtException', (error) =>
  console.error('UNCAUGHT EXCEPTION =>', error)
);

process.on('unhandledRejection', (error) =>
  console.error('UNHANDLED REJECTION =>', error)
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!isProduction) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origine non autorisée par CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
};

/**
 * =========================================================
 * WEBHOOK STRIPE — AVANT express.json()
 * =========================================================
 */
if (process.env.STRIPE_SECRET_KEY) {
  const { webhookRouter } = require('./routes/paymentRoutes');

  app.use(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    webhookRouter
  );
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/**
 * =========================================================
 * FIX EXPRESS 5 + express-mongo-sanitize
 * =========================================================
 *
 * Express 5 expose req.query comme getter.
 * express-mongo-sanitize essaye de le modifier directement.
 * On le rend donc réassignable avant le sanitizer.
 */
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: { ...req.query },
    writable: true,
    configurable: true,
    enumerable: true,
  });

  next();
});

app.use((req, res, next) => {
  mongoSanitize.sanitize(req.body, { replaceWith: '_' });
  mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  mongoSanitize.sanitize(req.headers, { replaceWith: '_' });

  next();
});

app.use(
  hpp({
    whitelist: ['sort', 'fields', 'page', 'limit', 'cuisine', 'city'],
  })
);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.includes('/webhook'),
  message: {
    success: false,
    message: 'Trop de requêtes. Réessaie dans quelques minutes.',
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Trop de tentatives. Réessaie dans 15 minutes.',
  },
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 30 : 500,
  message: {
    success: false,
    message: 'Trop de commandes en cours. Réessaie dans quelques minutes.',
  },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 20 : 200,
  message: {
    success: false,
    message: 'Trop de tentatives de paiement.',
  },
});

app.use('/api/', globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/orders', orderLimiter);
app.use('/api/payments', paymentLimiter);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(self), microphone=(), camera=()'
  );
  next();
});

app.use((req, res, next) => {
  req.requestId = buildRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

app.use((req, res, next) => {
  if (isShuttingDown) {
    return res.status(503).json({
      success: false,
      message: 'Serveur en cours de redémarrage. Réessayez dans un instant.',
      requestId: req.requestId,
    });
  }

  return next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - startedAt;

    if (!isProduction) {
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms (${req.requestId})`
      );
    }
  });

  next();
});

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Afroeat en ligne',
    environment: NODE_ENV,
    requestId: req.requestId,
  });
});

app.get('/health', (req, res) => {
  const readyState = mongoose.connection.readyState;
  const mongoState = getMongoStateLabel(readyState);

  return res.status(readyState === 1 ? 200 : 503).json({
    success: true,
    message: 'Afroeat API OK',
    environment: NODE_ENV,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(serverStartedAt).toISOString(),
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    server: {
      host: HOST,
      port: PORT,
      shuttingDown: isShuttingDown,
    },
    database: {
      stateCode: readyState,
      stateLabel: mongoState,
      connected: readyState === 1,
      name: mongoose.connection?.name || null,
      host: mongoose.connection?.host || null,
    },
    features: {
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  });
});

app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/restaurants', require('./routes/restaurantRoutes'));
app.use('/api/places', require('./routes/placeRoutes'));
app.use('/api/partner-applications', require('./routes/partnerApplicationRoutes'));
app.use('/api/menu', require('./routes/menuRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/delivery', require('./routes/deliveryRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// Mount payment method discovery and cash selection even when Stripe is
// not configured. Card/checkout/refund endpoints return 503 in that case.
// The raw-body webhook remains mounted above only when Stripe is configured.
const { router: paymentsRouter } = require('./routes/paymentRoutes');
app.use('/api/payments', paymentsRouter);

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route API introuvable.',
    requestId: req.requestId,
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route introuvable.',
    requestId: req.requestId,
  });
});

app.use((err, req, res, next) => {
  console.error('EXPRESS ERROR =>', {
    requestId: req?.requestId,
    method: req?.method,
    url: req?.originalUrl,
    message: err?.message,
    ...(isProduction ? {} : { stack: err?.stack }),
  });

  if (res.headersSent) return next(err);

  if (err.message === 'Origine non autorisée par CORS') {
    return res.status(403).json({
      success: false,
      message: 'Accès refusé par la politique CORS.',
      requestId: req.requestId,
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'Payload trop volumineux.',
      requestId: req.requestId,
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'JSON invalide.',
      requestId: req.requestId,
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Identifiant invalide.',
      requestId: req.requestId,
    });
  }

  if (err.name === 'ValidationError') {
    const firstMessage =
      Object.values(err.errors || {})
        .map((i) => i?.message)
        .find(Boolean) || 'Données invalides.';

    return res.status(400).json({
      success: false,
      message: firstMessage,
      requestId: req.requestId,
    });
  }

  if (err.type?.startsWith('Stripe')) {
    return res.status(402).json({
      success: false,
      message: err.message || 'Erreur paiement.',
      requestId: req.requestId,
    });
  }

  return res.status(err.status || 500).json({
    success: false,
    message: isProduction ? 'Erreur serveur.' : err.message || 'Erreur serveur.',
    requestId: req.requestId,
  });
});

const shutdown = async (signal) => {
  if (isShuttingDown) return;

  isShuttingDown = true;
  console.log(`\n⚠️  Signal reçu : ${signal}. Arrêt en cours...`);

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
      console.log('✅ Serveur HTTP arrêté');
    }
  } catch (error) {
    console.error('❌ Erreur fermeture serveur HTTP =>', error);
  }

  try {
    await mongoose.connection.close();
    console.log('✅ Connexion MongoDB fermée');
  } catch (error) {
    console.error('❌ Erreur fermeture MongoDB =>', error);
  }

  process.exit(0);
};

const startServer = async () => {
  try {
    console.log(`🚀 Démarrage Afroeat API [${NODE_ENV}]`);
    console.log(`🧩 Mongo URI : ${maskMongoUriForLogs(MONGO_URI)}`);

    await mongoose.connect(MONGO_URI, {
      autoIndex: NODE_ENV !== 'production',
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    console.log('✅ MongoDB connecté avec succès');
    console.log(`📦 Base de données : ${mongoose.connection.name}`);
    console.log(`🖥️  Hôte Mongo : ${mongoose.connection.host}`);

    mongoose.connection.on('error', (e) =>
      console.error('❌ MONGOOSE ERROR =>', e)
    );

    mongoose.connection.on('disconnected', () =>
      console.warn('⚠️  MongoDB déconnecté')
    );

    mongoose.connection.on('reconnected', () =>
      console.log('✅ MongoDB reconnecté')
    );

    httpServer = app.listen(PORT, HOST, () => {
      console.log(`✅ Serveur Afroeat lancé sur ${HOST}:${PORT}`);
      console.log(`🌍 Environnement : ${NODE_ENV}`);
      console.log(`🔗 Local : http://localhost:${PORT}`);
      console.log(
        `💳 Stripe : ${
          process.env.STRIPE_SECRET_KEY ? '✅ configuré' : '⚠️  non configuré'
        }`
      );

      if (!isProduction) {
        console.log('📡 Mode développement actif');
      }
    });

    httpServer.headersTimeout = 65000;
    httpServer.requestTimeout = 60000;
    httpServer.keepAliveTimeout = 65000;
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB =>', error);
    process.exit(1);
  }
};

// Exporte l'application pour les environnements serverless (Vercel) et les tests.
// Le serveur HTTP + la connexion MongoDB ne démarrent que lorsque le fichier est
// lancé directement (`node server.js`).
module.exports = app;

if (require.main === module) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  startServer();
}