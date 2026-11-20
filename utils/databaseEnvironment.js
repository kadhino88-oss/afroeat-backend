'use strict';

const NON_PRODUCTION_DATABASE_LABELS = new Set([
  'dev',
  'development',
  'local',
  'sandbox',
  'stage',
  'staging',
  'test',
  'testing',
]);

const hasNonProductionDatabaseLabel = (databaseName) =>
  String(databaseName || '')
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((label) => NON_PRODUCTION_DATABASE_LABELS.has(label));

const assertDatabaseEnvironment = ({
  deployEnvironment,
  expectedDatabaseName,
  actualDatabaseName,
} = {}) => {
  if (String(deployEnvironment || '').trim().toLowerCase() !== 'production') {
    return true;
  }

  const expected = String(expectedDatabaseName || '').trim();
  const actual = String(actualDatabaseName || '').trim();

  if (!expected) {
    throw new Error('AFROEAT_MONGO_DB_NAME est obligatoire pour une API de production.');
  }

  if (hasNonProductionDatabaseLabel(expected)) {
    throw new Error('AFROEAT_MONGO_DB_NAME ne peut pas désigner une base de test ou de staging.');
  }

  if (!actual || actual !== expected) {
    throw new Error('La base MongoDB connectée ne correspond pas à AFROEAT_MONGO_DB_NAME.');
  }

  if (hasNonProductionDatabaseLabel(actual)) {
    throw new Error('Une API de production ne peut pas utiliser une base de test ou de staging.');
  }

  return true;
};

module.exports = { assertDatabaseEnvironment, hasNonProductionDatabaseLabel };
