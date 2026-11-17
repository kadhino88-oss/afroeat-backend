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

test('chaque plat O Saveurs a une photo d’illustration JPEG légère', () => {
  const fs = require('fs');
  const { mediaPath } = require('../scripts/seed-partner');
  const data = loadPartner('osaveurs-annemasse');
  for (const item of data.items) {
    const file = mediaPath('osaveurs-annemasse', item.media);
    assert.ok(file, `photo manquante : ${item.name}`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length <= 900 * 1024, `photo trop lourde : ${item.media}`);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
  }
  assert.throws(() => mediaPath('osaveurs-annemasse', '../../.env'), /invalide/);
});
