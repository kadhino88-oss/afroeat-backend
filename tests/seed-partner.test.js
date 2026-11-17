const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPartner } = require('../scripts/seed-partner');

test('le fichier O Saveurs d’Afrique est valide et marque l’alcool', () => {
  const data = loadPartner('osaveurs-annemasse');
  assert.equal(data.restaurant.currency, 'EUR');
  assert.ok(data.items.length >= 50);
  const alcohol = data.items.filter((i) => i.containsAlcohol);
  assert.ok(alcohol.some((i) => /Chivas/.test(i.name)));
  assert.ok(!data.items.find((i) => i.name === 'Jus de bissap').containsAlcohol);
  assert.equal(new Set(data.items.map((i) => i.name)).size, data.items.length, 'noms en double');
});

test('une clé de partenaire invalide est refusée', () => {
  assert.throws(() => loadPartner('../secret'), /invalide/);
});
