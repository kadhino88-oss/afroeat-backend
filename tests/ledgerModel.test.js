'use strict';

// Modèle LedgerEntry : append-only (aucune mise à jour / suppression), validation stricte, index d'unicité.
// Les opérations interdites sont refusées par les hooks AVANT tout accès à la base : aucune connexion requise.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const LedgerEntry = require('../models/LedgerEntry');

const valid = (overrides = {}) => ({
  type: 'charge', currency: 'eur', amountMinor: 1250, party: 'customer', idempotencyKey: 'charge:order:abc',
  occurredAt: new Date('2026-03-01T10:00:00Z'), ...overrides,
});

const rejectsImmutable = (promiseFactory) => assert.rejects(Promise.resolve().then(promiseFactory), (error) => error.code === 'LEDGER_IMMUTABLE');

test('une écriture valide passe la validation, la devise est normalisée en majuscules', async () => {
  const entry = new LedgerEntry(valid());
  await entry.validate();
  assert.equal(entry.currency, 'EUR');
  assert.equal(entry.amountMinor, 1250);
});

test('toutes les opérations de requête de mise à jour ou de suppression sont refusées', async () => {
  const id = new mongoose.Types.ObjectId();
  await rejectsImmutable(() => LedgerEntry.updateOne({ _id: id }, { $set: { amountMinor: 1 } }));
  await rejectsImmutable(() => LedgerEntry.updateMany({}, { $set: { amountMinor: 1 } }));
  await rejectsImmutable(() => LedgerEntry.findOneAndUpdate({ _id: id }, { $set: { amountMinor: 1 } }));
  await rejectsImmutable(() => LedgerEntry.findByIdAndUpdate(id, { $set: { amountMinor: 1 } }));
  await rejectsImmutable(() => LedgerEntry.replaceOne({ _id: id }, valid()));
  await rejectsImmutable(() => LedgerEntry.findOneAndReplace({ _id: id }, valid()));
  await rejectsImmutable(() => LedgerEntry.deleteOne({ _id: id }));
  await rejectsImmutable(() => LedgerEntry.deleteMany({}));
  await rejectsImmutable(() => LedgerEntry.findOneAndDelete({ _id: id }));
  await rejectsImmutable(() => LedgerEntry.findByIdAndDelete(id));
});

test('bulkWrite : update / delete refusés (seul insertOne passe le hook)', async () => {
  await rejectsImmutable(() => LedgerEntry.bulkWrite([{ updateOne: { filter: {}, update: { $set: { amountMinor: 1 } } } }]));
  await rejectsImmutable(() => LedgerEntry.bulkWrite([{ deleteMany: { filter: {} } }]));
  await rejectsImmutable(() => LedgerEntry.bulkWrite([{ insertOne: { document: valid() } }, { replaceOne: { filter: {}, replacement: valid() } }]));
});

test('document existant : save, updateOne et deleteOne sont refusés', async () => {
  const entry = new LedgerEntry(valid());
  entry.isNew = false; // simule un document relu depuis la base
  await rejectsImmutable(() => entry.save());
  await rejectsImmutable(() => entry.updateOne({ $set: { amountMinor: 2 } }));
  await rejectsImmutable(() => entry.deleteOne());
});

test('validation : type, partie, devise, montant et meta invalides sont refusés', async () => {
  const bad = async (overrides, field) => {
    const error = await new LedgerEntry(valid(overrides)).validate().then(() => null, (e) => e);
    assert.ok(error, `${field} aurait dû être refusé`);
    assert.ok(error.errors[field], `erreur attendue sur ${field}`);
  };
  await bad({ type: 'bonus' }, 'type');
  await bad({ party: 'martian' }, 'party');
  await bad({ currency: 'EURO' }, 'currency');
  await bad({ currency: 'e1r' }, 'currency');
  await bad({ amountMinor: 0 }, 'amountMinor');
  await bad({ amountMinor: 12.5 }, 'amountMinor');
  await bad({ amountMinor: Number.MAX_SAFE_INTEGER + 2 }, 'amountMinor');
  await bad({ idempotencyKey: '' }, 'idempotencyKey');
  await bad({ idempotencyKey: 'x'.repeat(201) }, 'idempotencyKey');
  await bad({ occurredAt: undefined }, 'occurredAt');
  await bad({ meta: { nested: { a: 1 } } }, 'meta');
  await bad({ meta: ['a'] }, 'meta');
  await bad({ meta: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])) }, 'meta');
  await bad({ meta: { long: 'y'.repeat(600) } }, 'meta');
});

test('montants signés : sorties négatives acceptées, XOF/XAF en unités entières', async () => {
  await new LedgerEntry(valid({ type: 'refund', amountMinor: -1250 })).validate();
  await new LedgerEntry(valid({ currency: 'XOF', amountMinor: 5000 })).validate();
});

test('index : unicité sur idempotencyKey, index sur order et (type, occurredAt)', () => {
  const indexes = LedgerEntry.schema.indexes();
  const unique = indexes.find(([fields]) => fields.idempotencyKey === 1);
  assert.ok(unique, 'index idempotencyKey absent');
  assert.equal(unique[1].unique, true);
  assert.ok(indexes.some(([fields]) => Object.keys(fields).join() === 'order'));
  assert.ok(indexes.some(([fields]) => Object.keys(fields).join() === 'type,occurredAt'));
});
