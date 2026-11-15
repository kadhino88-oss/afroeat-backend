const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAddressInput, addAddress, removeAddress, MAX_SAVED_ADDRESSES } = require('../utils/savedAddresses');

test('adresse trop courte ou vide refusée, espaces normalisés', () => {
  assert.ok(parseAddressInput({ address: 'ab' }).error);
  assert.ok(parseAddressInput({}).error);
  assert.equal(parseAddressInput({ address: '  12   rue du Rhône,  Genève ', label: ' Maison ' }).value.address, '12 rue du Rhône, Genève');
});

test('la première adresse devient celle par défaut ; une seule par défaut à la fois', () => {
  let r = addAddress([], parseAddressInput({ address: '12 rue du Rhône, Genève', label: 'Maison' }).value);
  assert.equal(r.list[0].isDefault, true);
  r = addAddress(r.list, parseAddressInput({ address: '4 avenue de la Gare, Annemasse', label: 'Travail', isDefault: true }).value);
  assert.deepEqual(r.list.map((a) => a.isDefault), [false, true]);
});

test('doublon : pas de seconde ligne ; limite de 5 adresses', () => {
  let list = [];
  for (let i = 0; i < MAX_SAVED_ADDRESSES; i += 1) list = addAddress(list, parseAddressInput({ address: `${i + 10} rue Test, Genève` }).value).list;
  assert.equal(list.length, MAX_SAVED_ADDRESSES);
  assert.equal(addAddress(list, parseAddressInput({ address: '99 rue Autre, Genève' }).value).error?.includes('Maximum'), true);
  assert.equal(addAddress(list, parseAddressInput({ address: '10 RUE TEST, GENÈVE' }).value).list.length, MAX_SAVED_ADDRESSES);
});

test('supprimer l’adresse par défaut en désigne une autre', () => {
  const list = [{ _id: 'a', address: 'x'.repeat(6), isDefault: true }, { _id: 'b', address: 'y'.repeat(6), isDefault: false }];
  const next = removeAddress(list, 'a');
  assert.equal(next.length, 1);
  assert.equal(next[0].isDefault, true);
  assert.deepEqual(removeAddress(next, 'b'), []);
});
