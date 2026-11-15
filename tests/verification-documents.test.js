'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  isDocumentEncryptionConfigured,
  encryptDocument,
  decryptDocument,
} = require('../utils/documentCrypto');
const {
  getRequiredKinds,
  isFullyApproved,
  expiryAfterDays,
  PENDING_RETENTION_DAYS,
  DECIDED_RETENTION_DAYS,
} = require('../utils/verificationRules');

const ENV = { DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('sans clé valide, le chiffrement est indisponible (jamais de stockage en clair)', () => {
  assert.equal(isDocumentEncryptionConfigured({}), false);
  assert.equal(isDocumentEncryptionConfigured({ DOCUMENT_ENCRYPTION_KEY: 'trop-court' }), false);
  assert.equal(isDocumentEncryptionConfigured(ENV), true);
  assert.throws(() => encryptDocument(Buffer.from('x'), {}), /DOCUMENT_ENCRYPTION_KEY/);
});

test('une pièce chiffrée se relit à l’identique, et toute altération est détectée', () => {
  const plain = Buffer.from('contenu-d-une-piece-d-identite');
  const sealed = encryptDocument(plain, ENV);
  assert.notDeepEqual(sealed.data, plain);
  assert.deepEqual(decryptDocument(sealed, ENV), plain);
  const tampered = { ...sealed, data: Buffer.from(sealed.data) };
  tampered.data[0] ^= 0xff;
  assert.throws(() => decryptDocument(tampered, ENV));
  const otherKey = { DOCUMENT_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  assert.throws(() => decryptDocument(sealed, otherKey));
});

test('pièces demandées selon le rôle', () => {
  assert.deepEqual(getRequiredKinds('livreur'), ['identity', 'work_permit']);
  assert.deepEqual(getRequiredKinds('restaurant'), ['identity', 'business_registration']);
  assert.deepEqual(getRequiredKinds('client'), []);
});

test('vérifié seulement quand toutes les pièces demandées sont acceptées', () => {
  const ok = { kind: 'identity', status: 'approved' };
  assert.equal(isFullyApproved('livreur', [ok]), false);
  assert.equal(isFullyApproved('livreur', [ok, { kind: 'work_permit', status: 'pending' }]), false);
  assert.equal(isFullyApproved('livreur', [ok, { kind: 'work_permit', status: 'approved' }]), true);
  assert.equal(isFullyApproved('client', [ok]), false);
});

test('conservation : 90 jours en attente, 30 jours après la décision, effacement automatique', () => {
  assert.equal(PENDING_RETENTION_DAYS, 90);
  assert.equal(DECIDED_RETENTION_DAYS, 30);
  assert.equal(expiryAfterDays(30, 0).getTime(), 30 * 24 * 60 * 60 * 1000);
  assert.match(read('models', 'VerificationFile.js'), /index\(\{ expiresAt: 1 \}, \{ expireAfterSeconds: 0 \}\)/);
});

test('envoi : accord obligatoire, type demandé, chiffrement, et jamais de route publique', () => {
  const src = read('controllers', 'verificationController.js');
  assert.match(src, /req\.body\?\.consent !== true/);
  assert.match(src, /if \(!isDocumentEncryptionConfigured\(\)\) return notConfigured\(res\)/);
  assert.match(src, /encryptDocument\(parsed\.data\)/);
  // L'index d'effacement automatique est garanti avant tout envoi (autoIndex est coupé en production).
  assert.match(src, /await ensureFileIndexes\(\);\s+const fileExpiresAt/);
  const routes = read('routes', 'verificationRoutes.js');
  assert.match(routes, /router\.use\(protect, allowRoles\('livreur', 'restaurant'\)\)/);
  assert.doesNotMatch(routes, /file/);
});

test('administration : consultation tracée, lecture sans cache, derrière le verrou admin', () => {
  const src = read('controllers', 'verificationController.js');
  assert.match(src, /'view_verification_document'/);
  assert.match(src, /res\.set\('Cache-Control', 'no-store'\)/);
  const admin = read('routes', 'adminRoutes.js');
  const guard = admin.indexOf('router.use(requireAdminOrigin);');
  assert.ok(guard > 0 && admin.indexOf("router.get('/verification/:id/file'") > guard);
});

test('un refus exige un motif, et une pièce ne se traite qu’une fois', () => {
  const src = read('controllers', 'verificationController.js');
  assert.match(src, /decision === 'rejected' && reason\.length < 3/);
  assert.match(src, /\{ _id: req\.params\.id, status: 'pending' \}/);
});
