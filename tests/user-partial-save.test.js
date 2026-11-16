const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');

// Un compte chargé partiellement puis enregistré ne doit jamais voir ses champs absents écrasés par une chaîne vide.
const runPreSave = async (doc) => {
  const hooks = User.schema.s.hooks._pres.get('save') || [];
  for (const hook of hooks) {
    if (hook.fn && hook.fn.length <= 1 && !/next/.test(String(hook.fn).slice(0, 60))) {
      await hook.fn.call(doc);
    }
  }
};

test('une sélection partielle ne réécrit pas e-mail, nom, téléphone, adresse ni photo', async () => {
  const user = new User({ name: 'Awa', email: 'awa@example.com', password: 'Abcdef1#x', role: 'client' });
  // Simule un document chargé avec select('savedAddresses address')
  const partial = User.hydrate({ _id: user._id, address: '12 rue du Rhône', savedAddresses: [] }, { savedAddresses: 1, address: 1 });
  partial.isNew = false;
  await runPreSave(partial);
  assert.equal(partial.email, undefined);
  assert.equal(partial.name, undefined);
  assert.equal(partial.phone, undefined);
  assert.equal(partial.profileImage, undefined);
  assert.equal(partial.address, '12 rue du Rhône');
  assert.ok(!partial.modifiedPaths().includes('email'), 'e-mail marqué modifié');
  assert.ok(!partial.modifiedPaths().includes('name'), 'nom marqué modifié');
});

test('un compte complet est toujours normalisé (e-mail en minuscules, espaces retirés)', async () => {
  const full = new User({ name: '  Awa  ', email: '  AWA@Example.COM ', password: 'Abcdef1#x', role: 'client' });
  await runPreSave(full);
  assert.equal(full.email, 'awa@example.com');
  assert.equal(full.name, 'Awa');
});
