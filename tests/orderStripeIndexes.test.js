'use strict';

// Les index Stripe de Order doivent rester alignés sur ceux de la base existante (sparse), sinon
// la création échoue avec IndexOptionsConflict. Lecture du schéma uniquement : aucune base.

const test = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');

const findIndex = (field) =>
  Order.schema.indexes().find(([keys]) => Object.keys(keys).length === 1 && keys[field] === 1);

for (const field of ['stripePaymentIntentId', 'stripeCheckoutSessionId']) {
  test(`Order : index ${field} déclaré une seule fois, sparse, nom généré ${field}_1`, () => {
    const matches = Order.schema.indexes().filter(([keys]) => Object.keys(keys).length === 1 && keys[field] === 1);
    assert.equal(matches.length, 1, 'index déclaré une seule fois (niveau schéma, pas niveau champ en plus)');
    const [keys, options] = findIndex(field);
    assert.deepEqual(keys, { [field]: 1 });
    assert.equal(options.sparse, true);
    assert.equal(options.unique, undefined, 'pas d\'unicité ajoutée');
    // Nom que MongoDB génère pour cet index : doit correspondre à celui déjà en base.
    const generated = Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_');
    assert.equal(generated, `${field}_1`);
    assert.equal(options.name, undefined, 'aucun nom personnalisé : le nom généré est conservé');
  });

  test(`Order : le champ ${field} ne déclare pas d'index au niveau du champ`, () => {
    const path = Order.schema.path(field);
    assert.ok(path);
    assert.ok(!path.options.index && !path.options.unique && !path.options.sparse);
  });
}
