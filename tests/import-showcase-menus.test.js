const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MENUS = require('../data/showcase/menus');
const { planImport, NOTICE, SHOWCASE_OWNER_EMAIL } = require('../scripts/import-showcase-menus');

const root = path.join(__dirname, '..');
const spec = MENUS[0];
const fiche = (extra = {}) => ({ _id: 'a1', name: 'Bombay Snacks', isOpen: false, isActive: true, ...extra });

test('les menus sont valides : prix, noms, longueurs, doublons', () => {
  assert.equal(MENUS.length, 3);
  for (const m of MENUS) {
    assert.ok(['France', 'Suisse'].includes(m.country), m.key);
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

test('plan : fiche existante sans menu, ou création depuis un lieu d’annuaire unique et libre', () => {
  const lieu = (extra = {}) => ({ _id: 'p1', name: 'Bombay Snacks', ...extra });
  assert.equal(planImport({ spec }).reason, 'ni fiche ni lieu d’annuaire');
  assert.match(planImport({ spec, restaurants: [fiche(), fiche({ _id: 'a2' })] }).reason, /ambigu/);
  assert.match(planImport({ spec, restaurants: [fiche()], itemCount: 4 }).reason, /déjà 4/);
  assert.match(planImport({ spec, restaurants: [fiche({ isOpen: true })], owner: { accountStatus: 'active' } }).reason, /partenaire actif/);
  assert.equal(planImport({ spec, restaurants: [fiche()], owner: { accountStatus: 'active' } }).mode, 'fiche existante');
  assert.equal(planImport({ spec, restaurants: [fiche({ isOpen: true })], owner: { accountStatus: 'suspended' } }).action, 'import');
  assert.match(planImport({ spec, places: [lieu(), lieu({ _id: 'p2' })] }).reason, /ambigu/);
  assert.match(planImport({ spec, places: [lieu({ claimedRestaurant: 'r1' })] }).reason, /déjà repris/);
  const creation = planImport({ spec, places: [lieu()] });
  assert.equal(creation.action, 'import');
  assert.match(creation.mode, /création/);
  assert.equal(creation.placeId, 'p1');
});

test('le script ne supprime rien, ne crée aucune fiche, cible la base officielle ; le bouton exige la confirmation', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'import-showcase-menus.js'), 'utf8');
  assert.doesNotMatch(src, /deleteMany|deleteOne|remove\(|drop\(/);
  assert.match(src, /accountStatus: 'suspended'/);
  assert.match(src, /isOpen: false/);
  assert.match(SHOWCASE_OWNER_EMAIL, /@afroeat\.invalid$/);
  assert.match(src, /connectOfficialDatabase/);
  assert.match(NOTICE, /n'est pas partenaire AfroEat/);
  assert.match(NOTICE, /commande indisponible/);
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'import-showcase-menus.yml'), 'utf8');
  assert.match(wf, /CONFIRM" != "afroeatDB"/);
  assert.match(wf, /PLACES_MONGO_URI/);
  assert.match(wf, /permissions:\n\s+contents: read/);
});
