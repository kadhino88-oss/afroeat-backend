'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const { createTicket, updateTicket } = require('../controllers/supportController');

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const user = { _id: new mongoose.Types.ObjectId(), role: 'client' };
const long = 'Ma commande est arrivée froide et incomplète.';

test('routes : création pour tout compte connecté, gestion réservée à l’admin', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'supportRoutes.js'), 'utf8');
  assert.match(src, /router\.post\('\/tickets', protect, createTicket\)/);
  assert.match(src, /router\.get\('\/tickets\/mine', protect, listMyTickets\)/);
  assert.match(src, /router\.get\('\/tickets', protect, allowRoles\('admin'\), listAllTickets\)/);
  assert.match(src, /router\.patch\('\/tickets\/:id', protect, allowRoles\('admin'\), updateTicket\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /app\.use\('\/api\/support'/);
});

test('refuse sujet ou message manquant et message trop court', async () => {
  const a = res();
  await createTicket({ user, body: { subject: '', message: long } }, a);
  assert.equal(a.statusCode, 400);
  const b = res();
  await createTicket({ user, body: { subject: 'Retard', message: 'court' } }, b);
  assert.equal(b.statusCode, 422);
});

test('crée une demande, catégorie inconnue ramenée à « autre »', async () => {
  const origCount = SupportTicket.countDocuments; const origCreate = SupportTicket.create;
  let created;
  SupportTicket.countDocuments = async () => 0;
  SupportTicket.create = async (doc) => { created = doc; return { ...doc, _id: new mongoose.Types.ObjectId(), status: 'open' }; };
  const r = res();
  await createTicket({ user, body: { category: 'hack', subject: 'Retard', message: long } }, r);
  SupportTicket.countDocuments = origCount; SupportTicket.create = origCreate;
  assert.equal(r.statusCode, 201);
  assert.equal(created.category, 'autre');
  assert.equal(String(created.user), String(user._id));
  assert.equal(r.body.ticket.status, 'open');
  assert.equal(r.body.ticket.user, undefined);
});

test('limite le nombre de demandes ouvertes par compte', async () => {
  const orig = SupportTicket.countDocuments;
  SupportTicket.countDocuments = async () => 20;
  const r = res();
  await createTicket({ user, body: { subject: 'Retard', message: long } }, r);
  SupportTicket.countDocuments = orig;
  assert.equal(r.statusCode, 429);
});

test('admin : statut invalide refusé, réponse horodatée', async () => {
  const bad = res();
  await updateTicket({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { status: 'closed' } }, bad);
  assert.equal(bad.statusCode, 422);
  const orig = SupportTicket.findByIdAndUpdate; let update;
  SupportTicket.findByIdAndUpdate = async (id, doc) => { update = doc.$set; return { _id: id, status: update.status, adminResponse: update.adminResponse }; };
  const ok = res();
  await updateTicket({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { status: 'resolved', adminResponse: 'Remboursé.' } }, ok);
  SupportTicket.findByIdAndUpdate = orig;
  assert.equal(ok.body.ticket.status, 'resolved');
  assert.ok(update.respondedAt instanceof Date);
});
