'use strict';

// Doubles en mémoire pour le ledger : aucune base, aucun réseau. `create` passe par la VRAIE validation du
// schéma Mongoose (document.validate) et applique l'unicité de idempotencyKey comme l'index unique MongoDB.

const toComparable = (value) => {
  if (value instanceof Date) return value.getTime();
  if (value === undefined) return null;
  return value === null ? null : String(value);
};

const matchValue = (value, cond) => {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && !cond._bsontype) {
    return Object.entries(cond).every(([op, arg]) => {
      const left = toComparable(value);
      switch (op) {
        case '$in': return arg.some((candidate) => left === toComparable(candidate));
        case '$nin': return !arg.some((candidate) => left === toComparable(candidate));
        case '$ne': return left !== toComparable(arg);
        case '$gt': return left !== null && left > toComparable(arg);
        case '$gte': return left !== null && left >= toComparable(arg);
        case '$lt': return left !== null && left < toComparable(arg);
        case '$lte': return left !== null && left <= toComparable(arg);
        default: return false;
      }
    });
  }
  return toComparable(value) === toComparable(cond);
};

const matchDoc = (doc, filter = {}) => Object.entries(filter).every(([key, cond]) => (
  key === '$or' ? cond.some((sub) => matchDoc(doc, sub)) : matchValue(doc[key], cond)
));

// Requête chaînable minimale : select / sort({_id|champ: 1}) / limit / lean, puis then().
const makeQuery = (getDocs, filter) => {
  const state = { limit: Infinity, sort: null };
  const query = {
    select() { return query; },
    lean() { return query; },
    limit(n) { state.limit = n; return query; },
    sort(spec) { state.sort = spec; return query; },
    then(resolve, reject) {
      try {
        let docs = getDocs().filter((doc) => matchDoc(doc, filter));
        if (state.sort) {
          const [[field, dir]] = Object.entries(state.sort);
          docs = [...docs].sort((a, b) => (String(a[field]) < String(b[field]) ? -dir : String(a[field]) > String(b[field]) ? dir : 0));
        }
        resolve(docs.slice(0, state.limit).map((doc) => ({ ...doc })));
      } catch (error) { reject(error); }
    },
  };
  return query;
};

// Pipeline d'agrégation limité à ce que le code utilise : $match (occurredAt) puis $group (type, devise).
const runAggregate = (docs, pipeline) => {
  let rows = docs;
  for (const stage of pipeline) {
    if (stage.$match) rows = rows.filter((doc) => matchDoc(doc, stage.$match));
    if (stage.$group) {
      const groups = new Map();
      for (const doc of rows) {
        const id = { type: doc.type, currency: doc.currency };
        const key = `${id.type}|${id.currency}`;
        const group = groups.get(key) || { _id: id, count: 0, totalMinor: 0 };
        group.count += 1;
        group.totalMinor += doc.amountMinor;
        groups.set(key, group);
      }
      rows = [...groups.values()];
    }
  }
  return rows;
};

const installLedgerDouble = () => {
  const LedgerEntry = require('../../models/LedgerEntry');
  const ledger = require('../../utils/ledger');

  const entries = [];
  const state = { failCreate: null, failFind: null, createCalls: 0, ready: true };

  ledger.runtime.isReady = () => state.ready;
  LedgerEntry.findOne = (filter) => {
    const query = makeQuery(() => entries, filter);
    const first = { select() { return first; }, lean() { return first; }, then(resolve, reject) {
      if (state.failFind) return reject(state.failFind);
      return query.then((docs) => resolve(docs[0] || null), reject);
    } };
    return first;
  };
  LedgerEntry.find = (filter) => {
    if (state.failFind) {
      const failing = { select() { return failing; }, sort() { return failing; }, limit() { return failing; }, lean() { return failing; },
        then(resolve, reject) { reject(state.failFind); } };
      return failing;
    }
    return makeQuery(() => entries, filter);
  };
  LedgerEntry.create = async (doc) => {
    state.createCalls += 1;
    if (state.failCreate) throw state.failCreate;
    const entry = new LedgerEntry(doc);
    await entry.validate();
    if (entries.some((existing) => existing.idempotencyKey === entry.idempotencyKey)) {
      const error = new Error('E11000 duplicate key error');
      error.code = 11000;
      throw error;
    }
    entries.push(entry.toObject());
    return entry;
  };
  LedgerEntry.aggregate = async (pipeline) => runAggregate(entries, pipeline);

  return {
    LedgerEntry, ledger, entries, state,
    reset() { entries.length = 0; state.failCreate = null; state.failFind = null; state.createCalls = 0; state.ready = true; },
    byType: (type) => entries.filter((entry) => entry.type === type),
  };
};

// Remplace Order.find (et Order.aggregate non utilisé) par une lecture dans `store` (Map id -> doc).
const patchOrderFind = (Order, store) => {
  Order.find = (filter) => makeQuery(() => [...store.values()], filter);
};

module.exports = { installLedgerDouble, patchOrderFind, makeQuery, matchDoc, runAggregate };
