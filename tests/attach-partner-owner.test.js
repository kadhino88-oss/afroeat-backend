const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { planAttach } = require('../scripts/attach-partner-owner');

const resto = { _id: 'r1', owner: 'u-ancien' };

test('fiche sans propriétaire existant + e-mail inconnu : compte à créer, pays et devise corrigés', () => {
  const p = planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: null, country: 'FR' });
  assert.deepEqual(p, { ok: true, createAccount: true, regional: { country: 'France', currency: 'EUR' } });
  assert.deepEqual(planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: null, country: '' }).regional, null);
  assert.equal(planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: null, country: 'ch' }).regional.currency, 'CHF');
});

test('compte restaurateur existant réutilisé ; autre rôle refusé', () => {
  assert.equal(planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: { role: 'restaurant' } }).createAccount, false);
  for (const role of ['client', 'livreur', 'admin']) {
    const p = planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: { role } });
    assert.equal(p.ok, false);
    assert.match(p.reason, new RegExp(role));
  }
});

test('jamais de détournement : propriétaire actuel existant, fiche introuvable ou pays inconnu refusés', () => {
  assert.equal(planAttach({ restaurant: resto, currentOwnerExists: true, existingAccount: null }).ok, false);
  assert.equal(planAttach({ restaurant: null, currentOwnerExists: false, existingAccount: null }).ok, false);
  assert.match(planAttach({ restaurant: resto, currentOwnerExists: false, existingAccount: null, country: 'Belgique' }).reason, /France ou Suisse/);
});

test('le script vise la base officielle, n\'affiche aucun mot de passe et ne touche ni menu ni visibilité', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'attach-partner-owner.js'), 'utf8');
  assert.match(src, /connectOfficialDatabase/);
  assert.doesNotMatch(src, /mongoose\.connect\(/);
  assert.doesNotMatch(src, /console\.log\([^)]*password/i);
  assert.doesNotMatch(src, /MenuItem|isActive|isOpen/);
});

test('le bouton : simulation par défaut, confirmation exigée, aucune entrée interpolée dans un script', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'attach-partner-owner.yml'), 'utf8');
  assert.match(wf, /apply:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/);
  assert.match(wf, /CONFIRM" != "afroeatDB"/);
  const runs = wf.split(/\n\s+run: \|\n/).slice(1).map((b) => b.split(/\n\s{6}- /)[0]);
  assert.ok(runs.length >= 2);
  for (const block of runs) assert.doesNotMatch(block, /\$\{\{/);
  assert.match(wf, /permissions:\n\s+contents: read/);
});
