const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'migrate-production-data.yml'), 'utf8');

test('bouton de copie : simulation par défaut, confirmation exigée pour écrire', () => {
  assert.match(text, /apply:\s*\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/);
  assert.match(text, /CONFIRM" != "afroeatDB"/);
  // L'écriture n'a lieu que dans la branche « apply » ; l'autre commande n'a pas --apply.
  const lines = text.split('\n').filter((l) => l.includes('migrate-between-databases.js'));
  assert.equal(lines.length, 2);
  assert.equal(lines.filter((l) => l.includes('--apply')).length, 1);
});

test('bouton de copie : collections et bases figées, jamais de users, cible = production', () => {
  assert.match(text, /FROM_DB: afroeat_staging/);
  assert.match(text, /TO_DB: afroeatDB/);
  assert.match(text, /COLLECTIONS: restaurants,menuitems,places\n/);
  assert.doesNotMatch(text, /include-users|users\b.*COLLECTIONS/);
  assert.match(text, /AFROEAT_MONGO_DB_NAME: afroeatDB/);
});

test('bouton de copie : aucune entrée saisie n’est interpolée dans un script (injection), droits minimaux', () => {
  const runBlocks = text.split(/\n\s+run: \|\n/).slice(1).map((b) => b.split(/\n\s{6}- name:/)[0]);
  assert.ok(runBlocks.length >= 2);
  for (const block of runBlocks) assert.doesNotMatch(block, /\$\{\{/);
  assert.match(text, /permissions:\n\s+contents: read/);
  assert.match(text, /concurrency:/);
  // Le secret ne passe que par l'environnement, jamais affiché.
  assert.doesNotMatch(text, /echo[^\n]*MONGO_URI/);
});
