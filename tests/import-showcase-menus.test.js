const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MENUS = require('../data/showcase/menus');
const { planImport, NOTICE } = require('../scripts/import-showcase-menus');

const root = path.join(__dirname, '..');
const spec = MENUS[0];
const fiche = (extra = {}) => ({ _id: 'a1', name: 'Bombay Snacks', isOpen: false, isActive: true, ...extra });

test('les menus sont valides : prix, noms, longueurs, doublons', () => {
  assert.equal(MENUS.length, 3);
  for (const m of MENUS) {
    assert.ok(m.token && m.cuisine && /^https:\/\//.test(m.source), m.key);
    const noms = new Set();
    for (const i of m.items) {
      assert.ok(Number.isFinite(i.price) && i.price >= 0 && i.price < 200, `${m.key} ${i.name}`);
      assert.ok(i.name.length >= 2 && i.name.length <= 160 && i.description.length <= 1000 && i.category.length <= 100);
      const cle = `${i.category}|${i.name}`;
      assert.ok(!noms.has(cle), `doublon ${cle}`);
      noms.add(cle);
    }
  }
});

test('plan : importe seulement une fiche unique, sans menu, qui n’est pas un partenaire actif ouvert', () => {
  assert.equal(planImport({ spec, candidates: [], itemCount: 0, owner: null }).reason, 'fiche introuvable');
  assert.match(planImport({ spec, candidates: [fiche(), fiche({ _id: 'a2' })], itemCount: 0, owner: null }).reason, /ambigu/);
  assert.match(planImport({ spec, candidates: [fiche()], itemCount: 4, owner: null }).reason, /déjà 4/);
  assert.match(planImport({ spec, candidates: [fiche({ isOpen: true })], itemCount: 0, owner: { accountStatus: 'active' } }).reason, /partenaire actif/);
  assert.equal(planImport({ spec, candidates: [fiche()], itemCount: 0, owner: { accountStatus: 'active' } }).action, 'import');
  assert.equal(planImport({ spec, candidates: [fiche({ isOpen: true })], itemCount: 0, owner: { accountStatus: 'suspended' } }).action, 'import');
  assert.equal(planImport({ spec, candidates: [fiche({ isOpen: true })], itemCount: 0, owner: null }).action, 'import');
});

test('le script ne supprime rien, ne crée aucune fiche, cible la base officielle ; le bouton exige la confirmation', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'import-showcase-menus.js'), 'utf8');
  assert.doesNotMatch(src, /deleteMany|deleteOne|remove\(|Restaurant\.create|new Restaurant|drop\(/);
  assert.match(src, /connectOfficialDatabase/);
  assert.match(NOTICE, /n'est pas partenaire AfroEat/);
  assert.match(NOTICE, /commande indisponible/);
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'import-showcase-menus.yml'), 'utf8');
  assert.match(wf, /CONFIRM" != "afroeatDB"/);
  assert.match(wf, /PLACES_MONGO_URI/);
  assert.match(wf, /permissions:\n\s+contents: read/);
});
