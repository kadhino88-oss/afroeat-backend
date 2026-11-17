const test = require('node:test');
const assert = require('node:assert/strict');
const { toRating, publicAuthorName, evaluateReviewEligibility, addToAverage } = require('../utils/reviews');

test('notes de 1 à 5 étoiles entières', () => {
  assert.equal(toRating(5).value, 5);
  assert.equal(toRating(0).ok, false);
  assert.equal(toRating(4.5).ok, false);
  assert.equal(toRating(undefined, { optional: true }).value, null);
  assert.equal(toRating(undefined).ok, false);
});

test('nom public : prénom et initiale seulement', () => {
  assert.equal(publicAuthorName('Awa Diop Ndiaye'), 'Awa D.');
  assert.equal(publicAuthorName('Moussa'), 'Moussa');
  assert.equal(publicAuthorName(''), 'Client');
});

test('avis seulement sur sa commande livrée, dans les 14 jours', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  const order = { user: 'u1', status: 'Livrée', deliveredAt: new Date(now - 2 * 86400000) };
  assert.equal(evaluateReviewEligibility(order, 'u1', now).ok, true);
  assert.equal(evaluateReviewEligibility(order, 'u2', now).code, 'NOT_YOUR_ORDER');
  assert.equal(evaluateReviewEligibility({ ...order, status: 'En livraison' }, 'u1', now).code, 'ORDER_NOT_DELIVERED');
  assert.equal(evaluateReviewEligibility({ ...order, deliveredAt: new Date(now - 20 * 86400000) }, 'u1', now).code, 'REVIEW_WINDOW_CLOSED');
});

test('moyenne mise à jour', () => {
  assert.deepEqual(addToAverage(0, 0, 4), { average: 4, count: 1 });
  assert.deepEqual(addToAverage(4, 1, 5), { average: 4.5, count: 2 });
});
