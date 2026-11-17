const test = require('node:test');
const assert = require('node:assert/strict');
const { isChatOpen, cleanMessage, firstName, recipientsFor } = require('../utils/orderChat');

test('discussion ouverte pendant la commande et 2 h après', () => {
  const now = Date.parse('2026-12-01T12:00:00Z');
  assert.equal(isChatOpen({ status: 'En livraison' }, now), true);
  assert.equal(isChatOpen({ status: 'Livrée', deliveredAt: new Date(now - 30 * 60000) }, now), true);
  assert.equal(isChatOpen({ status: 'Livrée', deliveredAt: new Date(now - 3 * 3600000) }, now), false);
});

test('messages nettoyés et limités', () => {
  assert.equal(cleanMessage('  Bonjour\u0007 '), 'Bonjour');
  assert.equal(cleanMessage('x'.repeat(600)).length, 500);
  assert.equal(firstName('Awa Diop'), 'Awa');
});

test('destinataires : tous les participants sauf l’expéditeur', () => {
  const order = { user: 'c1', deliveryPerson: 'l1', restaurant: { owner: 'r1' } };
  assert.deepEqual(recipientsFor(order, 'l1'), ['c1', 'r1']);
  assert.deepEqual(recipientsFor({ user: 'c1', restaurant: { owner: 'r1' } }, 'c1'), ['r1']);
});
