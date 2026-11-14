'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mailer = require('../utils/mailer');
const PartnerApplication = require('../models/PartnerApplication');
const { adminNewApplicationEmail, applicantConfirmationEmail, inviteEmail } = require('../utils/partnerMails');
const { createApplication } = require('../controllers/partnerApplicationController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const body = { businessType: 'restaurant', businessName: 'Chez Fatou', contactName: 'Fatou Diop', email: 'fatou@exemple.ch', phone: '+41 79 111 22 33', address: 'Rue de Carouge 10', city: 'Genève', country: 'Suisse', consent: true };

const stub = async (fn) => {
  const sent = [];
  const orig = { send: mailer.sendMail, find: PartnerApplication.findOne, create: PartnerApplication.create };
  mailer.sendMail = async (mail) => { sent.push(mail); return { sent: true }; };
  PartnerApplication.findOne = () => ({ select: async () => null });
  PartnerApplication.create = async (d) => d;
  try { await fn(sent); } finally {
    mailer.sendMail = orig.send; PartnerApplication.findOne = orig.find; PartnerApplication.create = orig.create;
    delete process.env.PARTNER_NOTIFY_EMAIL;
  }
};

test('les textes ne contiennent aucun lien piégé et décrivent la candidature', () => {
  const admin = adminNewApplicationEmail(body, 'https://site.ch/admin/partner-applications');
  assert.match(admin.subject, /Chez Fatou/);
  assert.match(admin.text, /fatou@exemple\.ch/);
  assert.match(admin.text, /partner-applications/);
  const confirm = applicantConfirmationEmail(body);
  assert.match(confirm.text, /Fatou Diop/);
  const invite = inviteEmail(body, 'https://site.ch/auth/invite?token=abc', new Date(Date.now() + 7 * 86400000));
  assert.match(invite.text, /token=abc/);
  assert.match(invite.text, /7 jours/);
});

test('une candidature prévient l’équipe et accuse réception au candidat', async () => {
  await stub(async (sent) => {
    process.env.PARTNER_NOTIFY_EMAIL = 'equipe@exemple.ch';
    const r = res();
    await createApplication({ body }, r);
    assert.equal(r.statusCode, 201);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['equipe@exemple.ch', 'fatou@exemple.ch']);
  });
});

test('sans adresse équipe configurée, seul le candidat reçoit un accusé', async () => {
  await stub(async (sent) => {
    const r = res();
    await createApplication({ body }, r);
    assert.equal(r.statusCode, 201);
    assert.deepEqual(sent.map((m) => m.to), ['fatou@exemple.ch']);
  });
});

test('un échec d’envoi ne bloque jamais la candidature', async () => {
  await stub(async () => {
    mailer.sendMail = async () => { throw new Error('panne'); };
    const r = res();
    await createApplication({ body }, r);
    assert.equal(r.statusCode, 201);
  });
});

test('le champ piège (robot) n’envoie aucun e-mail', async () => {
  await stub(async (sent) => {
    const r = res();
    await createApplication({ body: { ...body, company: 'spam' } }, r);
    assert.equal(sent.length, 0);
  });
});
