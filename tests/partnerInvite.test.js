'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.PUBLIC_WEB_URL = 'https://afroeat-app.vercel.app';
const PartnerApplication = require('../models/PartnerApplication');
const User = require('../models/User');
const {
  generateInviteToken,
  hashInviteToken,
  getInviteState,
  validateInviteRegistration,
} = require('../utils/partnerInvite');
const { createInvite, getInvite, registerFromInvite } = require('../controllers/partnerApplicationController');

const mockRes = () => ({
  statusCode: 200,
  body: null,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

const baseApp = (extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  businessName: 'Chez Maman Afrik',
  businessType: 'restaurant',
  contactName: 'Awa',
  email: 'awa@example.com',
  phone: '+41791234567',
  address: 'Rue du Rhône 1',
  city: 'Genève',
  country: 'Suisse',
  status: 'new',
  inviteTokenHash: '',
  inviteExpiresAt: null,
  inviteUsedAt: null,
  async save() { return this; },
  ...extra,
});

test('le jeton est aléatoire, long, et seule son empreinte est stockée', () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashInviteToken(a.token));
  assert.notEqual(a.tokenHash, a.token);
  assert.ok(a.expiresAt > new Date());
});

test("état d'invitation : valide, expirée, déjà utilisée, absente", () => {
  const { tokenHash, expiresAt } = generateInviteToken();
  assert.equal(getInviteState(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt })).ok, true);
  assert.equal(getInviteState(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: new Date(Date.now() - 1000) })).code, 'INVITE_EXPIRED');
  assert.equal(getInviteState(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt, inviteUsedAt: new Date() })).code, 'INVITE_USED');
  assert.equal(getInviteState(baseApp()).code, 'INVITE_INVALID');
  assert.equal(getInviteState(null).code, 'INVITE_INVALID');
  assert.equal(getInviteState(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt, status: 'rejected' })).code, 'INVITE_INVALID');
});

test('le partenaire ne saisit que nom, téléphone et mot de passe (mot de passe fort exigé)', () => {
  assert.deepEqual(validateInviteRegistration({ name: 'Awa Diop', phone: '+41 79 123 45 67', password: 'Motdepasse1!' }), {
    name: 'Awa Diop',
    phone: '+41791234567',
    password: 'Motdepasse1!',
  });
  assert.throws(() => validateInviteRegistration({ name: 'A', phone: '+41791234567', password: 'Motdepasse1!' }), /nom/);
  assert.throws(() => validateInviteRegistration({ name: 'Awa', phone: '12', password: 'Motdepasse1!' }), /téléphone/);
  assert.throws(() => validateInviteRegistration({ name: 'Awa', phone: '+41791234567', password: 'faible' }), /mot de passe/i);
});

test("l'admin génère un lien https sans stocker le jeton en clair, et la candidature passe à « approved »", async () => {
  const application = baseApp();
  PartnerApplication.findById = async () => application;
  User.findOne = () => ({ select: async () => null });
  const res = mockRes();
  await createInvite({ params: { id: String(application._id) } }, res);
  assert.equal(res.statusCode, 200);
  const match = res.body.inviteUrl.match(/^https:\/\/afroeat-app\.vercel\.app\/auth\/invite\?token=([a-f0-9]{64})$/);
  assert.ok(match, res.body.inviteUrl);
  assert.equal(application.inviteTokenHash, hashInviteToken(match[1]));
  assert.notEqual(application.inviteTokenHash, match[1]);
  assert.equal(application.status, 'approved');
});

test("pas d'invitation si un compte existe déjà ou si la demande est refusée", async () => {
  PartnerApplication.findById = async () => baseApp();
  User.findOne = () => ({ select: async () => ({ _id: 'x' }) });
  let res = mockRes();
  await createInvite({ params: { id: 'a' } }, res);
  assert.equal(res.statusCode, 409);

  PartnerApplication.findById = async () => baseApp({ status: 'rejected' });
  User.findOne = () => ({ select: async () => null });
  res = mockRes();
  await createInvite({ params: { id: 'a' } }, res);
  assert.equal(res.statusCode, 409);
});

const stubInvite = (application) => {
  PartnerApplication.findOne = () => ({ select: async () => application });
};

test('la page publique ne révèle que le nécessaire et refuse un jeton mal formé', async () => {
  const { token, tokenHash, expiresAt } = generateInviteToken();
  stubInvite(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt }));
  let res = mockRes();
  await getInvite({ params: { token } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.invite).sort(), ['businessName', 'businessType', 'contactName', 'email', 'expiresAt', 'phone']);

  res = mockRes();
  await getInvite({ params: { token: 'pas-un-jeton' } }, res);
  assert.equal(res.statusCode, 404);
});

test('inscription par invitation : le compte est créé avec le mot de passe choisi, une seule fois', async () => {
  const { token, tokenHash, expiresAt } = generateInviteToken();
  const application = baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt });
  stubInvite(application);
  User.findOne = () => ({ select: async () => null });
  let claimedOnce = false;
  PartnerApplication.findOneAndUpdate = async () => {
    if (claimedOnce) return null;
    claimedOnce = true;
    return application;
  };
  PartnerApplication.updateOne = async () => ({});
  let saved = null;
  User.prototype.save = async function save() { saved = this; return this; };

  const body = { name: 'Awa Diop', phone: '+41791234567', password: 'Motdepasse1!' };
  let res = mockRes();
  await registerFromInvite({ params: { token }, body }, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(saved.email, 'awa@example.com');
  assert.equal(saved.role, 'restaurant');
  assert.equal(saved.accountStatus, 'active');
  assert.equal(saved.isIdentityVerified, false);
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.password, undefined);

  // Deuxième envoi avec le même lien : refusé.
  res = mockRes();
  await registerFromInvite({ params: { token }, body }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.body.code, 'INVITE_USED');
});

test('mot de passe faible : refusé sans consommer le lien', async () => {
  const { token, tokenHash, expiresAt } = generateInviteToken();
  stubInvite(baseApp({ inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt }));
  let consumed = false;
  PartnerApplication.findOneAndUpdate = async () => { consumed = true; return {}; };
  const res = mockRes();
  await registerFromInvite({ params: { token }, body: { name: 'Awa', phone: '+41791234567', password: 'faible' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(consumed, false);
});

test('invitation de livreur : compte « livreur », non disponible et non vérifié tant que l’admin n’a pas validé', async () => {
  const { token, tokenHash, expiresAt } = generateInviteToken();
  const application = baseApp({ businessType: 'courier', inviteTokenHash: tokenHash, inviteExpiresAt: expiresAt });
  stubInvite(application);
  User.findOne = () => ({ select: async () => null });
  PartnerApplication.findOneAndUpdate = async () => application;
  PartnerApplication.updateOne = async () => ({});
  let saved = null;
  User.prototype.save = async function save() { saved = this; return this; };

  const res = mockRes();
  await registerFromInvite({ params: { token }, body: { name: 'Moussa Livreur', phone: '+41791234567', password: 'Motdepasse1!' } }, res);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(saved.role, 'livreur');
  assert.equal(res.body.role, 'livreur');
  assert.equal(saved.isAvailable, false);
  assert.equal(saved.isIdentityVerified, false);
  assert.equal(saved.isWorkAuthorized, false);
  const { evaluateCourierAssignmentEligibility } = require('../utils/courierAssignmentEligibility');
  assert.equal(evaluateCourierAssignmentEligibility(saved).ok, false);
});

test('« courier » est un type de candidature accepté', () => {
  const { validateApplication } = require('../utils/partnerApplication');
  const data = validateApplication({
    businessName: 'Moussa Diallo', businessType: 'courier', contactName: 'Moussa Diallo',
    email: 'moussa@example.com', phone: '+41791234567', address: 'Annemasse', city: 'Annemasse', consent: true,
  });
  assert.equal(data.businessType, 'courier');
});
