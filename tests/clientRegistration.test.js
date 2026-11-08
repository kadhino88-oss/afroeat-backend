const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { validateRegistrationPayload } = require('../controllers/userController');

// Ce que envoie réellement l'écran d'inscription client de l'appli.
const clientBody = {
  role: 'client',
  firstName: 'Awa',
  lastName: 'Traoré',
  name: 'Awa Traoré',
  email: 'awa@example.com',
  password: 'Motdepasse1!',
  phone: '+33612345678',
  address: '5 rue Alfred Bastin, Annemasse',
  country: 'France',
  onboardingStatus: 'completed',
};

test("un client peut s'inscrire avec ce que l'appli envoie (sans pièce d'identité)", () => {
  const data = validateRegistrationPayload(clientBody);
  assert.equal(data.role, 'client');
  assert.equal(data.email, 'awa@example.com');
  assert.equal(data.identityDocument, null);
});

test('une date de naissance fournie est contrôlée (majeur)', () => {
  const year = new Date().getFullYear() - 10;
  assert.throws(
    () => validateRegistrationPayload({ ...clientBody, birthDate: `${year}-01-01` }),
    /majeur/
  );
  assert.throws(
    () => validateRegistrationPayload({ ...clientBody, birthDate: '01/01/1990' }),
    /AAAA-MM-JJ/
  );
});

test('le mot de passe faible et les champs de base restent refusés', () => {
  assert.throws(() => validateRegistrationPayload({ ...clientBody, password: 'abc' }), /mot de passe/i);
  assert.throws(() => validateRegistrationPayload({ ...clientBody, phone: '123' }), /téléphone/);
  assert.throws(() => validateRegistrationPayload({ ...clientBody, address: '' }), /adresse/);
});

test("restaurants et livreurs gardent la vérification d'identité complète", () => {
  process.env.ALLOW_PARTNER_SELF_REGISTER = 'true';
  assert.throws(
    () => validateRegistrationPayload({ ...clientBody, role: 'livreur' }),
    /nationalité/
  );
});
