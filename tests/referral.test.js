const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReferralCode } = require('../utils/referral');
const { isValidCode } = require('../utils/promoCodes');

test('code de parrainage lisible et valide', () => {
  assert.equal(buildReferralCode('Awa Diop', '7K2F'), 'AWA-7K2F');
  assert.equal(buildReferralCode('Émilie-Zoé', 'AB12'), 'EMILIE-AB12');
  assert.equal(buildReferralCode('', 'ZZ99'), 'AMI-ZZ99');
  assert.ok(isValidCode(buildReferralCode('Moussa Konaté')));
});
