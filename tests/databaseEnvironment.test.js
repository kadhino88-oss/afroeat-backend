'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertDatabaseEnvironment,
  hasNonProductionDatabaseLabel,
} = require('../utils/databaseEnvironment');

test('production accepts only the explicitly configured production database', () => {
  assert.equal(
    assertDatabaseEnvironment({
      deployEnvironment: 'production',
      expectedDatabaseName: 'afroeat_live',
      actualDatabaseName: 'afroeat_live',
    }),
    true
  );
});

test('production requires an expected database name', () => {
  assert.throws(
    () => assertDatabaseEnvironment({ deployEnvironment: 'production', actualDatabaseName: 'afroeat_live' }),
    /AFROEAT_MONGO_DB_NAME est obligatoire/
  );
});

test('production rejects a mismatch between configured and connected databases', () => {
  assert.throws(
    () => assertDatabaseEnvironment({
      deployEnvironment: 'production',
      expectedDatabaseName: 'afroeat_live',
      actualDatabaseName: 'afroeat_staging',
    }),
    /ne correspond pas/
  );
});

test('production rejects test, staging, development, local and sandbox database names', () => {
  for (const databaseName of [
    'afroeat_test',
    'afroeat-testing',
    'afroeat_staging',
    'afroeat-development',
    'afroeat_local',
    'afroeat_sandbox',
  ]) {
    assert.equal(hasNonProductionDatabaseLabel(databaseName), true);
    assert.throws(
      () => assertDatabaseEnvironment({
        deployEnvironment: 'production',
        expectedDatabaseName: databaseName,
        actualDatabaseName: databaseName,
      }),
      /base de test ou de staging/
    );
  }
});

test('non-production deployments do not enforce a production database name', () => {
  assert.equal(
    assertDatabaseEnvironment({
      deployEnvironment: 'staging',
      expectedDatabaseName: 'afroeat_live',
      actualDatabaseName: 'afroeat_staging',
    }),
    true
  );
});
