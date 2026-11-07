// Point d'entrée serverless (Vercel). Réutilise l'application Express existante
// et garde une connexion MongoDB en cache entre les invocations.
const mongoose = require('mongoose');
const app = require('../server');

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
let connecting = null;

const ensureDatabase = async () => {
  if (mongoose.connection.readyState === 1) return;

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
};

module.exports = async (req, res) => {
  const isHealthCheck = String(req.url || '').split('?')[0] === '/health';

  try {
    await ensureDatabase();
  } catch (error) {
    console.error('MongoDB indisponible =>', error?.message);

    // /health doit répondre même si la base est injoignable (il l'indique).
    if (!isHealthCheck) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          message: 'Base de données indisponible.',
        })
      );
      return;
    }
  }

  return app(req, res);
};
