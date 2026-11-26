'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { syncModelIndexes } = require('../utils/syncModelIndexes');

const makeModel = ({ failAll = false, conflictOn = null } = {}) => {
  const created = [];
  const indexes = [
    [{ a: 1 }, { name: 'a_1' }],
    [{ b: 1 }, { name: 'b_1' }],
    [{ c: 1 }, { unique: true, name: 'c_1' }],
  ];
  return {
    created,
    model: {
      createIndexes: async () => {
        if (failAll || conflictOn) throw new Error('An existing index has the same name');
      },
      schema: { indexes: () => indexes },
      collection: {
        createIndex: async (fields) => {
          if (conflictOn && Object.keys(fields)[0] === conflictOn) throw new Error('IndexOptionsConflict');
          created.push(Object.keys(fields)[0]);
        },
      },
    },
  };
};

test('createIndexes réussi : rien à signaler', async () => {
  const { model } = makeModel();
  assert.deepEqual(await syncModelIndexes(model), { ok: true, failed: [] });
});

test('un index en conflit n\'empêche pas la création des autres', async () => {
  const { model, created } = makeModel({ conflictOn: 'b' });
  const result = await syncModelIndexes(model);
  assert.equal(result.ok, false);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].key, /"b":1/);
  assert.deepEqual(created, ['a', 'c']);
});

test('aucun index n\'est jamais supprimé', async () => {
  const { model } = makeModel({ conflictOn: 'a' });
  model.collection.dropIndex = () => { throw new Error('ne doit pas être appelé'); };
  model.collection.dropIndexes = () => { throw new Error('ne doit pas être appelé'); };
  await syncModelIndexes(model);
});
