'use strict';

// Copie de collections entre deux bases du MÊME cluster (ex. afroeat_staging -> afroeatDB), SANS jamais
// supprimer ni modifier la cible : seuls les documents dont l'_id est absent de la cible sont insérés.
// Aucune expression régulière sur les entrées ; aucun contenu de document n'est lu pour l'affichage ni journalisé
// (compteurs et noms de collections uniquement, même dans les erreurs : les messages MongoDB peuvent citer des valeurs).
//
// `db` attendu (sous-ensemble du driver MongoDB) : db.collection(name) avec
//   countDocuments(), find(filter, { projection, sort, limit }).toArray(), insertMany(docs, { ordered: false }).

const fs = require('fs');
const path = require('path');
const { hasNonProductionDatabaseLabel } = require('./databaseEnvironment');

const BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const MAX_NAME_LENGTH = 63;

const USERS_COLLECTION = 'users';

const SENSITIVE_WARNINGS = Object.freeze({
  users: 'mots de passe hachés, jetons (refresh / réinitialisation / push) et secrets 2FA chiffrés avec DOCUMENT_ENCRYPTION_KEY : la clé de la cible doit être IDENTIQUE à celle de la source, sinon les secrets 2FA copiés seront illisibles.',
  verificationdocuments: 'pièces d\'identité chiffrées avec DOCUMENT_ENCRYPTION_KEY (clé identique requise) et données personnelles.',
  verificationfiles: 'fichiers de vérification d\'identité chiffrés avec DOCUMENT_ENCRYPTION_KEY (clé identique requise) et données personnelles.',
  orders: 'données clients et identifiants Stripe : des commandes issues d\'une base de test (Stripe test) n\'ont aucun sens en production et faussent la comptabilité.',
  ledgerentries: 'journal comptable : y mélanger des écritures de test fausse le rapprochement avec Stripe.',
  ledgerreconciliationreports: 'rapports de rapprochement liés à une base précise.',
  stripeevents: 'journal d\'événements Stripe (mode test vs live) : ne pas mélanger.',
  ordermessages: 'messages privés entre clients, restaurants et livreurs.',
  supporttickets: 'données personnelles de clients.',
  partnerapplications: 'données personnelles de candidats partenaires.',
  adminauditlogs: 'journal d\'audit administrateur.',
});

/** Collections autorisées = collections Mongoose des modèles du dépôt (liste blanche, jamais d'autre nom). */
const deriveAllowedCollections = () => {
  // eslint-disable-next-line global-require
  const mongoose = require('mongoose');
  const modelsDir = path.join(__dirname, '..', 'models');
  for (const file of fs.readdirSync(modelsDir)) {
    if (file.endsWith('.js')) require(path.join(modelsDir, file)); // eslint-disable-line global-require
  }
  return mongoose.modelNames().map((name) => mongoose.model(name).collection.name).sort();
};

// Nom de base / de collection : lettres, chiffres, « _ », « - », « . » (pas pour les bases), longueur bornée.
const isSafeName = (value, { allowDot = false } = {}) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME_LENGTH) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || (allowDot && c === 46);
    if (!ok) return false;
  }
  return true;
};

const VALUE_FLAGS = ['--from', '--to', '--collections', '--confirm-users', '--batch-size'];
const BOOLEAN_FLAGS = ['--apply', '--include-users'];

/**
 * Lecture linéaire de la ligne de commande (--clé valeur ou --clé=valeur). Aucune valeur par défaut pour --collections.
 * @returns {{ error?: string, from?: string, to?: string, collections?: string[], apply?: boolean, includeUsers?: boolean,
 *   confirmUsers?: string, batchSize?: number }}
 */
const parseMigrationArgs = (argv) => {
  const out = { apply: false, includeUsers: false, confirmUsers: null, batchSize: BATCH_SIZE };
  const values = {};
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = String(list[i]);
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    if (BOOLEAN_FLAGS.includes(flag)) {
      if (eq !== -1) return { error: `Option ${flag} sans valeur.` };
      if (flag === '--apply') out.apply = true;
      else out.includeUsers = true;
    } else if (VALUE_FLAGS.includes(flag)) {
      let value;
      if (eq !== -1) value = raw.slice(eq + 1);
      else { i += 1; value = list[i]; }
      if (typeof value !== 'string' || value === '' || value.startsWith('--')) return { error: `Valeur manquante pour ${flag}.` };
      if (flag in values) return { error: `Option ${flag} répétée.` };
      values[flag] = value;
    } else {
      return { error: `Option inconnue : ${flag.slice(0, 40)}.` };
    }
  }

  if (!values['--from']) return { error: '--from est obligatoire.' };
  if (!values['--to']) return { error: '--to est obligatoire.' };
  if (!values['--collections']) return { error: '--collections est obligatoire (aucune valeur par défaut, aucune migration « tout »).' };
  if (!isSafeName(values['--from']) || !isSafeName(values['--to'])) return { error: 'Nom de base invalide.' };

  const collections = [];
  for (const part of values['--collections'].split(',')) {
    const name = part.trim();
    if (!name) return { error: '--collections contient un nom vide.' };
    if (!isSafeName(name, { allowDot: false })) return { error: 'Nom de collection invalide.' };
    if (!collections.includes(name)) collections.push(name);
  }

  if ('--batch-size' in values) {
    const size = Number(values['--batch-size']);
    if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) return { error: `--batch-size doit être un entier entre 1 et ${MAX_BATCH_SIZE}.` };
    out.batchSize = size;
  }
  if ('--confirm-users' in values) out.confirmUsers = values['--confirm-users'];

  return { ...out, from: values['--from'], to: values['--to'], collections };
};

/**
 * Valide la demande AVANT toute connexion. Ne lève pas : renvoie { ok:false, error } ou { ok:true, plan, warnings }.
 */
const validateMigrationRequest = (args, { env = process.env, allowedCollections } = {}) => {
  if (!args || args.error) return { ok: false, error: args?.error || 'Arguments invalides.' };
  const allowed = Array.isArray(allowedCollections) ? allowedCollections : [];

  if (args.from === args.to) return { ok: false, error: '--from et --to doivent être différents.' };

  const expectedTarget = String(env.AFROEAT_MONGO_DB_NAME || '').trim();
  if (expectedTarget && args.to !== expectedTarget) {
    return { ok: false, error: '--to doit être égal à AFROEAT_MONGO_DB_NAME (la base de production configurée).' };
  }
  if (hasNonProductionDatabaseLabel(args.to)) {
    return { ok: false, error: '--to ne peut pas être une base de test / staging / dev / sandbox / local.' };
  }

  for (const name of args.collections) {
    if (!allowed.includes(name)) return { ok: false, error: `Collection non autorisée : ${name}.` };
  }

  const wantsUsers = args.collections.includes(USERS_COLLECTION);
  if (wantsUsers && !args.includeUsers) {
    return { ok: false, error: 'La collection users n\'est copiée qu\'avec --include-users.' };
  }
  if (args.includeUsers && !wantsUsers) {
    return { ok: false, error: '--include-users sans « users » dans --collections.' };
  }
  if (wantsUsers && args.apply && args.confirmUsers !== args.to) {
    return { ok: false, error: `Copie de users avec --apply : ajouter --confirm-users ${args.to} (nom exact de la base cible).` };
  }

  const warnings = args.collections
    .filter((name) => SENSITIVE_WARNINGS[name])
    .map((name) => ({ collection: name, message: SENSITIVE_WARNINGS[name] }));
  return { ok: true, warnings };
};

const idsOf = (docs) => docs.map((doc) => doc._id);

/**
 * Copie une collection par lots bornés (pagination par _id croissant). En simulation : lectures seules.
 * @returns {Promise<{ collection, source, alreadyPresent, toCopy, copied, uniqueConflicts, errors }>}
 */
const migrateCollection = async ({ sourceDb, targetDb, name, apply, batchSize = BATCH_SIZE }) => {
  const source = sourceDb.collection(name);
  const target = targetDb.collection(name);
  const stats = { collection: name, source: 0, alreadyPresent: 0, toCopy: 0, copied: 0, uniqueConflicts: 0, errors: 0 };
  const size = Math.min(Math.max(1, batchSize | 0), MAX_BATCH_SIZE);

  let lastId;
  let hasLast = false;
  for (;;) {
    const filter = hasLast ? { _id: { $gt: lastId } } : {};
    const batch = await source.find(filter, { sort: { _id: 1 }, limit: size }).toArray();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id;
    hasLast = true;
    stats.source += batch.length;

    const present = await target.find({ _id: { $in: idsOf(batch) } }, { projection: { _id: 1 } }).toArray();
    const presentKeys = new Set(present.map((doc) => keyOf(doc._id)));
    const missing = batch.filter((doc) => !presentKeys.has(keyOf(doc._id)));
    stats.alreadyPresent += batch.length - missing.length;
    stats.toCopy += missing.length;

    if (apply && missing.length > 0) {
      try {
        const result = await target.insertMany(missing, { ordered: false });
        stats.copied += Number(result?.insertedCount ?? missing.length);
      } catch (error) {
        // insertMany ordered:false : les documents valides sont insérés malgré les erreurs. On ne lit JAMAIS error.message.
        const rawWriteErrors = error?.writeErrors; // tableau, ou objet seul selon la version du driver
        const writeErrors = Array.isArray(rawWriteErrors) ? rawWriteErrors : (rawWriteErrors ? [rawWriteErrors] : []);
        const duplicateOnly = writeErrors.length > 0 && writeErrors.every((e) => (e?.code ?? e?.err?.code) === 11000);
        const inserted = Number(error?.result?.insertedCount ?? error?.insertedCount ?? (missing.length - writeErrors.length));
        stats.copied += Math.max(0, inserted);
        if (duplicateOnly) {
          stats.uniqueConflicts += writeErrors.length;
        } else {
          stats.errors += 1;
          stats.errorCode = error?.code ?? null;
          return stats; // arrêt de cette collection : on ne continue pas sur une erreur inattendue
        }
      }
    }
  }
  return stats;
};

// Clé comparable d'un _id (ObjectId, chaîne, nombre) sans exposer de contenu ailleurs.
const keyOf = (id) => `${typeof id}:${String(id)}`;

/** Exécute la migration pour toutes les collections demandées (séquentiellement). Ne lève pas pour une erreur de collection. */
const runMigration = async ({ client, from, to, collections, apply, batchSize = BATCH_SIZE }) => {
  const sourceDb = client.db(from);
  const targetDb = client.db(to);
  const results = [];
  for (const name of collections) {
    try {
      results.push(await migrateCollection({ sourceDb, targetDb, name, apply, batchSize }));
    } catch (error) {
      results.push({ collection: name, source: 0, alreadyPresent: 0, toCopy: 0, copied: 0, uniqueConflicts: 0, errors: 1, errorCode: error?.code ?? null, errorName: error?.name });
    }
  }
  return results;
};

module.exports = {
  BATCH_SIZE, SENSITIVE_WARNINGS, USERS_COLLECTION,
  deriveAllowedCollections, parseMigrationArgs, validateMigrationRequest, migrateCollection, runMigration, isSafeName,
};
