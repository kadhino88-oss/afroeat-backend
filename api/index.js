// Point d'entrée serverless (Vercel). Réutilise l'application Express existante
// et garde une connexion MongoDB en cache entre les invocations.
const mongoose = require('mongoose');
const app = require('../server');
const { assertDatabaseEnvironment } = require('../utils/databaseEnvironment');

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const DEPLOY_ENVIRONMENT = String(process.env.AFROEAT_DEPLOY_ENV || '').trim();
const EXPECTED_DATABASE_NAME = String(process.env.AFROEAT_MONGO_DB_NAME || '').trim();
let connecting = null;

const ensureDatabase = async () => {
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const isPlaceholderJwtSecret = /^(replace|change[-_ ]?me|placeholder|example)/i.test(jwtSecret);
  if (!jwtSecret || jwtSecret.length < 32 || isPlaceholderJwtSecret) {
    throw new Error('JWT_SECRET manquant, trop faible ou encore défini sur une valeur de remplacement');
  }

  const verifyDatabase = () =>
    assertDatabaseEnvironment({
      deployEnvironment: DEPLOY_ENVIRONMENT,
      expectedDatabaseName: EXPECTED_DATABASE_NAME,
      actualDatabaseName: mongoose.connection?.name,
    });

  if (mongoose.connection.readyState === 1) {
    verifyDatabase();
    return;
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI manquant');
  }

  if (!connecting) {
    connecting = mongoose
      .connect(MONGO_URI, {
        // Les index sont créés explicitement avec `npm run db:sync-indexes`.
        autoIndex: false,
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      })
      .catch((error) => {
        connecting = null;
        throw error;
      });
  }

  await connecting;
  verifyDatabase();
};

module.exports = async (req, res) => {
  const isHealthCheck = String(req.url || '').split('?')[0] === '/health';

  try {
    await ensureDatabase();
  } catch (error) {
    console.error('MongoDB indisponible =>', error?.message);

    // Toute erreur de disponibilité ou d'identité de base doit rester fail-closed,
    // y compris sur /health (ne jamais déclarer prête une API sur la mauvaise base).
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        message: isHealthCheck
          ? 'API non prête : vérifier la connexion et la base MongoDB configurée.'
          : 'Base de données indisponible.',
      })
    );
    return;
  }

  return app(req, res);
};
