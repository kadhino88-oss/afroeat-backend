const test = require('node:test');
const assert = require('node:assert/strict');
const { validateApplication } = require('../utils/partnerApplication');

const valid = {
  businessName: 'Chez Awa',
  businessType: 'restaurant',
  contactName: 'Awa Traoré',
  email: 'Awa@Example.com',
  phone: '+33 6 12 34 56 78',
  address: '5 rue Alfred Bastin',
  city: 'Annemasse',
  consent: true,
};

test('une demande valide est nettoyée', () => {
  const data = validateApplication(valid);
  assert.equal(data.email, 'awa@example.com');
  assert.equal(data.businessType, 'restaurant');
  assert.equal(data.consent, true);
});

test('champs obligatoires et formats', () => {
  assert.throws(() => validateApplication({ ...valid, businessName: '' }), /nom du commerce/);
  assert.throws(() => validateApplication({ ...valid, businessType: 'banque' }), /type de commerce/);
  assert.throws(() => validateApplication({ ...valid, email: 'pas-un-email' }), /email/);
  assert.throws(() => validateApplication({ ...valid, phone: 'abc' }), /téléphone/);
  assert.throws(() => validateApplication({ ...valid, city: '' }), /ville/);
  assert.throws(() => validateApplication({ ...valid, website: 'javascript:alert(1)' }), /http/);
});

test("l'accord pour être contacté est obligatoire", () => {
  assert.throws(() => validateApplication({ ...valid, consent: false }), /accord/);
});

test('les textes trop longs sont tronqués', () => {
  const data = validateApplication({ ...valid, message: 'x'.repeat(5000) });
  assert.equal(data.message.length, 1000);
});

test('route publique limitée et route admin protégée', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const publicRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'partnerApplicationRoutes.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminRoutes.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(publicRoute, /rateLimit/);
  assert.match(server, /\/api\/partner-applications/);
  assert.ok(admin.indexOf('router.use(requireAdmin)') < admin.indexOf("'/partner-applications'"));
});
