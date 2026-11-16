const test = require('node:test');
const assert = require('node:assert/strict');
const { canDeleteRole, buildAnonymizedFields, accountDeletionPageHtml, ACTIVE_ORDER_STATUSES } = require('../utils/accountLifecycle');
const userRoutes = require('../routes/userRoutes');

test('seuls client, restaurant et livreur peuvent supprimer leur compte', () => {
  assert.equal(canDeleteRole('client'), true);
  assert.equal(canDeleteRole('restaurant'), true);
  assert.equal(canDeleteRole('livreur'), true);
  assert.equal(canDeleteRole('admin'), false);
  assert.equal(canDeleteRole(''), false);
});

test("l'anonymisation efface toute donnée personnelle", () => {
  const f = buildAnonymizedFields('abc123', 'x', new Date('2026-01-01'));
  assert.equal(f.name, 'Compte supprimé');
  assert.match(f.email, /^deleted-abc123@deleted\.afroeat\.invalid$/);
  assert.equal(f.phone, '');
  assert.equal(f.address, '');
  assert.equal(f.pushToken, '');
  assert.equal(f.accountStatus, 'deleted');
  assert.equal(f.isAvailable, false);
});

test('une commande en cours bloque la suppression', () => {
  assert.ok(ACTIVE_ORDER_STATUSES.includes('En livraison'));
  assert.ok(!ACTIVE_ORDER_STATUSES.includes('Livrée'));
  assert.ok(!ACTIVE_ORDER_STATUSES.includes('Annulée'));
});

test('page publique de suppression + routes enregistrées', () => {
  assert.match(accountDeletionPageHtml('a@b.c'), /Supprimer mon compte/);
  const paths = userRoutes.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  assert.ok(paths.includes('delete /me/account'));
  assert.ok(paths.includes('get /me/export'));
  assert.ok(paths.includes('get /account-deletion'));
});

test("l'export des données ne contient aucun secret", () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'controllers', 'accountController.js'), 'utf8');
  const start = src.indexOf('const exportMyData');
  const body = src.slice(start, src.indexOf('accountDeletionPage = ', start));
  for (const secret of ['password', 'passwordResetTokenHash', 'twoFactor']) assert.match(body, new RegExp(secret));
  assert.match(body, /\.\.\.profile/);
});
