'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { accountUpgradedEmail } = require('../utils/partnerMails');

const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'partnerApplicationController.js'), 'utf8');

test('approbation : un compte client existant devient le compte partenaire', () => {
  assert.match(src, /existingUser\.role = isCourier \? 'livreur' : 'restaurant'/);
  assert.match(src, /accountUpgraded: true/);
});

test('approbation : un compte admin, partenaire ou suspendu n’est jamais transformé', () => {
  assert.match(src, /existingUser\.role !== 'client' \|\| existingUser\.accountStatus === 'suspended'/);
  assert.match(src, /ACCOUNT_ALREADY_PARTNER/);
});

test('un livreur issu d’un compte existant reste à vérifier et indisponible', () => {
  assert.match(src, /existingUser\.isIdentityVerified = false;\s+existingUser\.isWorkAuthorized = false;\s+existingUser\.isAvailable = false;/);
});

test('e-mail d’acceptation : mot de passe habituel, aucun lien d’invitation', () => {
  const mail = accountUpgradedEmail(
    { contactName: 'Awa', businessType: 'courier' },
    'https://exemple.test/auth/login?role=livreur'
  );
  assert.match(mail.subject, /acceptée/);
  assert.match(mail.text, /mot de passe habituel/);
  assert.match(mail.text, /auth\/login\?role=livreur/);
  assert.doesNotMatch(mail.text, /invite/);
});
