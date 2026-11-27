const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OFFICIAL_DATABASE, expectedDatabaseName, connectOfficialDatabase } = require('../utils/officialDatabase');

test('base officielle par défaut : afroeatDB ; EXPECT_DB ou AFROEAT_MONGO_DB_NAME la remplacent explicitement', () => {
  assert.equal(OFFICIAL_DATABASE, 'afroeatDB');
  assert.equal(expectedDatabaseName({}), 'afroeatDB');
  assert.equal(expectedDatabaseName({ AFROEAT_MONGO_DB_NAME: 'autreBase' }), 'autreBase');
  assert.equal(expectedDatabaseName({ EXPECT_DB: 'afroeat_test', AFROEAT_MONGO_DB_NAME: 'x' }), 'afroeat_test');
});

test('un nom de base douteux est refusé', () => {
  for (const bad of ['a/b', 'a b', 'a$b', '', 'x'.repeat(64), '../etc']) {
    if (bad === '') assert.equal(expectedDatabaseName({ EXPECT_DB: bad }), 'afroeatDB'); // vide = défaut
    else assert.throws(() => expectedDatabaseName({ EXPECT_DB: bad }), /Nom de base invalide/, bad);
  }
});

test('la connexion impose le nom de base (dbName) quel que soit le chemin de l\'adresse, et vérifie le résultat', async () => {
  const calls = [];
  const good = { connection: { name: 'afroeatDB' }, connect: async (uri, opts) => calls.push([uri, opts]), disconnect: async () => calls.push('disc') };
  assert.equal(await connectOfficialDatabase(good, 'mongodb://h/afroeat_staging', {}), 'afroeatDB');
  assert.deepEqual(calls[0][1], { dbName: 'afroeatDB' });
  const wrong = { connection: { name: 'afroeat_staging' }, connect: async () => {}, disconnect: async () => calls.push('disc') };
  await assert.rejects(() => connectOfficialDatabase(wrong, 'mongodb://h/x', {}), /Refusé/);
  assert.ok(calls.includes('disc'));
  await assert.rejects(() => connectOfficialDatabase(good, '', {}), /MONGO_URI manquant/);
});

test('les scripts des boutons GitHub visent la base officielle : plus de défaut afroeat_staging ni de connexion brute', () => {
  for (const f of ['enrich-place-media', 'seed-partner', 'set-restaurant-active', 'launch-test-restaurant', 'merge-duplicate-restaurant', 'promote-admin', 'import-curated-places', 'import-osm-places']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', `${f}.js`), 'utf8');
    assert.doesNotMatch(src, /\|\| 'afroeat_staging'/, f);
    assert.doesNotMatch(src, /mongoose\.connect\(/, `${f} : utiliser connectOfficialDatabase`);
    assert.match(src, /connectOfficialDatabase/, f);
  }
});
