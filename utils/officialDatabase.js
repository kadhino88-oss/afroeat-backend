'use strict';

// Base officielle (production) ciblée par les boutons GitHub d'administration : afroeatDB.
// Le nom de la base est imposé par le code (option dbName) : peu importe la base écrite à la fin de l'adresse de
// connexion du secret PLACES_MONGO_URI, on n'écrit jamais ailleurs que dans la base attendue.
// EXPECT_DB (ou AFROEAT_MONGO_DB_NAME) permet de viser une autre base, volontairement et explicitement.
const OFFICIAL_DATABASE = 'afroeatDB';
const SAFE_NAME = /^[A-Za-z0-9_-]{1,63}$/;

const expectedDatabaseName = (env = process.env) => {
  const name = String(env.EXPECT_DB || env.AFROEAT_MONGO_DB_NAME || OFFICIAL_DATABASE).trim();
  if (!SAFE_NAME.test(name)) throw new Error('Nom de base invalide (lettres, chiffres, « _ » et « - » uniquement).');
  return name;
};

const connectOfficialDatabase = async (mongoose, uri, env = process.env) => {
  const dbName = expectedDatabaseName(env);
  if (!String(uri || '').trim()) throw new Error('MONGO_URI manquant.');
  await mongoose.connect(uri, { dbName });
  if (mongoose.connection.name !== dbName) {
    await mongoose.disconnect();
    throw new Error(`Refusé : base « ${mongoose.connection.name} » au lieu de « ${dbName} ».`);
  }
  return dbName;
};

module.exports = { OFFICIAL_DATABASE, expectedDatabaseName, connectOfficialDatabase };
