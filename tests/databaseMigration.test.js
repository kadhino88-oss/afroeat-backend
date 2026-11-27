'use strict';

// Migration entre deux bases : validation des arguments, simulation sans écriture, --apply n'insère que les absents,
// idempotence, refus des cas interdits. Fausse connexion en mémoire : aucune base, aucun réseau.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const {
  deriveAllowedCollections, parseMigrationArgs, validateMigrationRequest, migrateCollection, runMigration, BATCH_SIZE,
} = require('../utils/databaseMigration');

const ALLOWED = deriveAllowedCollections();
const validate = (argv, env = {}) => validateMigrationRequest(parseMigrationArgs(argv), { env, allowedCollections: ALLOWED });
const BASE = ['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', 'restaurants,menuitems'];

// --- Fausse connexion en mémoire --------------------------------------------------------------------------------
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const matches = (doc, filter = {}) => Object.entries(filter).every(([key, cond]) => {
  if (key !== '_id') return doc[key] === cond;
  if (cond && typeof cond === 'object') {
    if ('$gt' in cond) return cmp(doc._id, cond.$gt) > 0;
    if ('$in' in cond) return cond.$in.includes(doc._id);
  }
  return doc._id === cond;
});

const createFakeClient = (data, { uniqueKey = null, failWith = null, insertLog = [] } = {}) => {
  const dbs = new Map(Object.entries(data).map(([dbName, collections]) => [
    dbName, new Map(Object.entries(collections).map(([name, docs]) => [name, docs.map((d) => ({ ...d }))])),
  ]));
  const ops = [];
  const getColl = (dbName, name) => {
    if (!dbs.has(dbName)) dbs.set(dbName, new Map());
    if (!dbs.get(dbName).has(name)) dbs.get(dbName).set(name, []);
    return dbs.get(dbName).get(name);
  };
  return {
    ops,
    dump: (dbName, name) => (dbs.get(dbName)?.get(name) || []).map((d) => ({ ...d })),
    db: (dbName) => ({
      collection: (name) => ({
        find: (filter, options = {}) => ({
          toArray: async () => {
            ops.push(`find:${dbName}.${name}`);
            let docs = getColl(dbName, name).filter((d) => matches(d, filter)).sort((a, b) => cmp(a._id, b._id));
            if (options.limit) docs = docs.slice(0, options.limit);
            return docs.map((d) => (options.projection ? { _id: d._id } : { ...d }));
          },
        }),
        insertMany: async (docs, options) => {
          ops.push(`insertMany:${dbName}.${name}`);
          assert.equal(options.ordered, false);
          insertLog.push({ db: dbName, name, count: docs.length });
          if (failWith) throw failWith;
          const store = getColl(dbName, name);
          const writeErrors = [];
          let insertedCount = 0;
          for (const doc of docs) {
            const dupId = store.some((d) => d._id === doc._id);
            const dupKey = uniqueKey && store.some((d) => d[uniqueKey] === doc[uniqueKey]);
            if (dupId || dupKey) { writeErrors.push({ code: 11000 }); continue; }
            store.push({ ...doc });
            insertedCount += 1;
          }
          if (writeErrors.length) throw Object.assign(new Error('E11000 duplicate key { email: "secret@exemple.ch" }'), { code: 11000, writeErrors, result: { insertedCount } });
          return { insertedCount };
        },
        // Toute méthode destructive appelée par erreur fait échouer le test.
        deleteMany: () => { throw new Error('deleteMany interdit'); },
        deleteOne: () => { throw new Error('deleteOne interdit'); },
        updateOne: () => { throw new Error('updateOne interdit'); },
        updateMany: () => { throw new Error('updateMany interdit'); },
        replaceOne: () => { throw new Error('replaceOne interdit'); },
        drop: () => { throw new Error('drop interdit'); },
        bulkWrite: () => { throw new Error('bulkWrite interdit'); },
      }),
      dropDatabase: () => { throw new Error('dropDatabase interdit'); },
    }),
  };
};

const docs = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ _id: `${prefix}${String(i).padStart(5, '0')}`, name: `n${i}`, ...extra }));

// --- Arguments ---------------------------------------------------------------------------------------------------

test('arguments : forme valide, --opt=valeur, dédoublonnage, simulation par défaut', () => {
  const args = parseMigrationArgs(['--from=afroeat_staging', '--to', 'afroeatDB', '--collections', 'restaurants, menuitems,restaurants']);
  assert.deepEqual([args.from, args.to, args.collections, args.apply, args.includeUsers, args.batchSize], ['afroeat_staging', 'afroeatDB', ['restaurants', 'menuitems'], false, false, BATCH_SIZE]);
  assert.equal(validate(BASE).ok, true);
});

test('arguments : --collections obligatoire, sans défaut ni « tout »', () => {
  assert.match(validate(['--from', 'afroeat_staging', '--to', 'afroeatDB']).error, /--collections est obligatoire/);
  assert.equal(validate(['--from', 'a1', '--to', 'b1', '--collections', '']).ok, false);
  assert.equal(validate(['--from', 'a1', '--to', 'b1', '--collections']).ok, false);
  for (const wildcard of ['*', 'all', 'tout', 'restaurants,', '$cmd', 'a b', 'system.users', '../x', 'users;drop']) {
    assert.equal(validate(['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', wildcard]).ok, false, wildcard);
  }
});

test('arguments : options inconnues, répétées ou mal formées refusées', () => {
  for (const extra of [['--force'], ['--apply=true'], ['--from', 'x2'], ['--batch-size', '0'], ['--batch-size', '5000'], ['--batch-size', 'abc'], ['positional']]) {
    assert.equal(validate([...BASE, ...extra]).ok, false, extra.join(' '));
  }
  assert.equal(validate(['--from', 'a b', '--to', 'afroeatDB', '--collections', 'restaurants']).ok, false);
  assert.equal(validate(['--from', 'a'.repeat(100), '--to', 'afroeatDB', '--collections', 'restaurants']).ok, false);
  assert.equal(parseMigrationArgs(undefined).error.length > 0, true);
});

// --- Refus des cas interdits ------------------------------------------------------------------------------------

test('refus : from === to', () => {
  assert.match(validate(['--from', 'afroeatDB', '--to', 'afroeatDB', '--collections', 'restaurants']).error, /différents/);
});

test('refus : cible non production (staging, test, dev, sandbox, local...)', () => {
  for (const target of ['afroeat_staging', 'afroeat-test', 'afroeat_dev', 'sandbox', 'local', 'afroeat.testing', 'Staging']) {
    const result = validate(['--from', 'afroeatDB', '--to', target, '--collections', 'restaurants']);
    assert.equal(result.ok, false, target);
  }
});

test('refus : --to différent de AFROEAT_MONGO_DB_NAME quand elle est définie ; accepté quand égal', () => {
  assert.equal(validate(BASE, { AFROEAT_MONGO_DB_NAME: 'autreProd' }).ok, false);
  assert.equal(validate(BASE, { AFROEAT_MONGO_DB_NAME: 'afroeatDB' }).ok, true);
  assert.equal(validate(BASE, { AFROEAT_MONGO_DB_NAME: '  ' }).ok, true);
});

test('refus : collection hors liste blanche (la liste blanche vient des modèles du dépôt)', () => {
  for (const name of ['system', 'admin', 'sessions', 'config', 'unknowncollection']) {
    assert.match(validate(['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', `restaurants,${name}`]).error, /non autorisée/, name);
  }
  const modelFiles = fs.readdirSync(path.join(__dirname, '..', 'models')).filter((f) => f.endsWith('.js'));
  assert.equal(ALLOWED.length, modelFiles.length, 'une collection par modèle');
  for (const expected of ['restaurants', 'menuitems', 'users', 'orders', 'ledgerentries']) assert.ok(ALLOWED.includes(expected), expected);
});

test('users : exige --include-users (et --include-users exige users) ; --apply exige en plus --confirm-users <base cible>', () => {
  const users = ['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', 'restaurants,users'];
  assert.match(validate(users).error, /--include-users/);
  assert.equal(validate([...users, '--include-users']).ok, true, 'simulation autorisée');
  assert.match(validate([...users, '--include-users', '--apply']).error, /--confirm-users afroeatDB/);
  assert.equal(validate([...users, '--include-users', '--apply', '--confirm-users', 'autre']).ok, false);
  assert.equal(validate([...users, '--include-users', '--apply', '--confirm-users', 'afroeatDB']).ok, true);
  assert.match(validate([...BASE, '--include-users']).error, /sans « users »/);
});

test('avertissements : users rappelle DOCUMENT_ENCRYPTION_KEY ; collections sans champ sensible : aucun', () => {
  const withUsers = validate(['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', 'users', '--include-users']);
  assert.equal(withUsers.warnings.length, 1);
  assert.match(withUsers.warnings[0].message, /DOCUMENT_ENCRYPTION_KEY/);
  assert.match(withUsers.warnings[0].message, /IDENTIQUE/);
  assert.deepEqual(validate(BASE).warnings, []);
});

// --- Migration ---------------------------------------------------------------------------------------------------

test('simulation : compte source / déjà présents / à copier, aucune écriture', async () => {
  const client = createFakeClient({
    afroeat_staging: { restaurants: docs('r', 5), menuitems: docs('m', 3) },
    afroeatDB: { restaurants: [...docs('r', 2), { _id: 'zzz', name: 'prod only' }] },
  });
  const before = client.dump('afroeatDB', 'restaurants');
  const results = await runMigration({ client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants', 'menuitems'], apply: false });
  assert.deepEqual(results.map((r) => [r.collection, r.source, r.alreadyPresent, r.toCopy, r.copied]), [['restaurants', 5, 2, 3, 0], ['menuitems', 3, 0, 3, 0]]);
  assert.ok(!client.ops.some((op) => op.startsWith('insertMany')), 'aucun insertMany en simulation');
  assert.deepEqual(client.dump('afroeatDB', 'restaurants'), before);
  assert.equal(client.dump('afroeatDB', 'menuitems').length, 0);
});

test('--apply : n\'insère que les absents, ne touche jamais aux documents existants de la cible', async () => {
  const targetExisting = [{ _id: 'r00000', name: 'VERSION CIBLE' }, { _id: 'zzz', name: 'prod only' }];
  const client = createFakeClient({
    afroeat_staging: { restaurants: docs('r', 4) },
    afroeatDB: { restaurants: targetExisting },
  });
  const [result] = await runMigration({ client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants'], apply: true });
  assert.deepEqual([result.source, result.alreadyPresent, result.toCopy, result.copied, result.errors], [4, 1, 3, 3, 0]);
  const after = client.dump('afroeatDB', 'restaurants');
  assert.equal(after.length, 5);
  assert.equal(after.find((d) => d._id === 'r00000').name, 'VERSION CIBLE', 'document existant inchangé');
  assert.ok(after.some((d) => d._id === 'zzz'));
  assert.equal(client.dump('afroeat_staging', 'restaurants').length, 4, 'la source n\'est pas modifiée');
});

test('idempotence : une deuxième exécution --apply n\'insère rien', async () => {
  const client = createFakeClient({ afroeat_staging: { restaurants: docs('r', 7) }, afroeatDB: {} });
  const args = { client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants'], apply: true };
  const [first] = await runMigration(args);
  assert.equal(first.copied, 7);
  client.ops.length = 0;
  const [second] = await runMigration(args);
  assert.deepEqual([second.source, second.alreadyPresent, second.toCopy, second.copied], [7, 7, 0, 0]);
  assert.ok(!client.ops.some((op) => op.startsWith('insertMany')));
});

test('lots bornés : 1201 documents -> insertMany par lots de 500 au plus ; --batch-size respecté', async () => {
  const insertLog = [];
  const client = createFakeClient({ afroeat_staging: { menuitems: docs('m', 1201) }, afroeatDB: {} }, { insertLog });
  const [result] = await migrateCollection({ sourceDb: client.db('afroeat_staging'), targetDb: client.db('afroeatDB'), name: 'menuitems', apply: true }).then((r) => [r]);
  assert.equal(result.copied, 1201);
  assert.deepEqual(insertLog.map((l) => l.count), [500, 500, 201]);

  insertLog.length = 0;
  const client2 = createFakeClient({ afroeat_staging: { menuitems: docs('m', 25) }, afroeatDB: {} }, { insertLog });
  await migrateCollection({ sourceDb: client2.db('afroeat_staging'), targetDb: client2.db('afroeatDB'), name: 'menuitems', apply: true, batchSize: 10 });
  assert.deepEqual(insertLog.map((l) => l.count), [10, 10, 5]);
});

test('doublons d\'index unique (hors _id) : ignorés et comptés, sans jamais afficher le contenu', async (t) => {
  const logs = [];
  for (const level of ['log', 'warn', 'error']) t.mock.method(console, level, (...a) => logs.push(a.join(' ')));
  const client = createFakeClient({
    afroeat_staging: { restaurants: [{ _id: 'a', slug: 's1' }, { _id: 'b', slug: 's2' }, { _id: 'c', slug: 's3' }] },
    afroeatDB: { restaurants: [{ _id: 'zz', slug: 's2' }] },
  }, { uniqueKey: 'slug' });
  const [result] = await runMigration({ client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants'], apply: true });
  assert.deepEqual([result.toCopy, result.copied, result.uniqueConflicts, result.errors], [3, 2, 1, 0]);
  assert.ok(!JSON.stringify(result).includes('secret@exemple.ch'));
  assert.equal(logs.length, 0, 'le module lui-même n\'affiche rien');
});

test('erreur inattendue : collection interrompue, code seul rapporté, jamais le message', async () => {
  const leak = 'valeur-sensible-dans-le-message';
  const client = createFakeClient(
    { afroeat_staging: { restaurants: docs('r', 3), menuitems: docs('m', 2) }, afroeatDB: {} },
    { failWith: Object.assign(new Error(leak), { code: 13 }) }
  );
  const results = await runMigration({ client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants', 'menuitems'], apply: true });
  assert.ok(results.every((r) => r.errors === 1 && r.errorCode === 13));
  assert.ok(!JSON.stringify(results).includes(leak));
});

test('writeErrors sous forme d\'objet unique (driver) : traité comme un doublon', async () => {
  const dupe = Object.assign(new Error('E11000'), { code: 11000, writeErrors: { code: 11000 }, result: { insertedCount: 1 } });
  const client = createFakeClient({ afroeat_staging: { restaurants: docs('r', 2) }, afroeatDB: {} }, { failWith: dupe });
  const [result] = await runMigration({ client, from: 'afroeat_staging', to: 'afroeatDB', collections: ['restaurants'], apply: true });
  assert.deepEqual([result.copied, result.uniqueConflicts, result.errors], [1, 1, 0]);
});

// --- Script : refus avant toute connexion --------------------------------------------------------------------

const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-between-databases.js');
const runScript = (argv, env = {}) => spawnSync(process.execPath, [SCRIPT, ...argv], {
  encoding: 'utf8', timeout: 20000, cwd: os.tmpdir(), // cwd hors dépôt : dotenv ne lit aucun .env local
  env: { PATH: process.env.PATH, MONGO_URI: 'mongodb://127.0.0.1:1/unreachable', ...env },
});

test('script : refus (exit 1) avant toute connexion pour les cas interdits', () => {
  for (const argv of [
    ['--from', 'afroeat_staging', '--to', 'afroeatDB'],
    ['--from', 'afroeatDB', '--to', 'afroeat_staging', '--collections', 'restaurants'],
    ['--from', 'afroeatDB', '--to', 'afroeatDB', '--collections', 'restaurants'],
    ['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', 'sessions'],
    ['--from', 'afroeat_staging', '--to', 'afroeatDB', '--collections', 'users'],
  ]) {
    const result = runScript(argv);
    assert.equal(result.status, 1, argv.join(' '));
    assert.match(result.stderr, /Refusé/);
    assert.ok(!result.stdout.includes('Mode'), 'aucune exécution démarrée');
  }
});

test('script : MONGO_URI absent -> refus après validation, sans connexion', () => {
  const result = spawnSync(process.execPath, [SCRIPT, ...BASE], { encoding: 'utf8', timeout: 20000, cwd: os.tmpdir(), env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MONGO_URI est requis/);
});
