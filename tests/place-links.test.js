const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanWebsite, cleanImageUrl, isCompetitorUrl } = require('../utils/placeLinks');

test('les liens vers les plateformes concurrentes sont retirés', () => {
  assert.equal(cleanWebsite('https://www.ubereats.com/fr/store/djerba/abc'), '');
  assert.equal(cleanWebsite('https://www.just-eat.ch/en/menu/x'), '');
  assert.equal(cleanWebsite('https://deliveroo.fr/menu/lyon/x'), '');
  assert.equal(cleanWebsite('https://www.smood.ch/fr/x'), '');
  assert.equal(cleanWebsite('https://o-saveur-d-afrique.eatbu.com/'), 'https://o-saveur-d-afrique.eatbu.com/');
  assert.equal(isCompetitorUrl('https://beat.ch'), false, 'ne pas confondre beat.ch avec eat.ch');
});

test('les images inutilisables sont retirées', () => {
  assert.equal(cleanImageUrl('https://lovable.dev/opengraph-image-p98pqg.png'), '');
  assert.equal(cleanImageUrl('https://restaurantivoire.pro/'), '');
  assert.equal(cleanImageUrl('https://media.ffycdn.net/eu/x/clip.mp4?format=webp'), '');
  assert.equal(cleanImageUrl('https://lh3.googleusercontent.com/a-/ALV-abc=w40-h40'), '');
  assert.equal(cleanImageUrl('http://exemple.ch/photo.jpg'), '', 'http refusé (contenu mixte)');
  const ok = 'https://cdn.website.dish.co/media/a3/d0/2305010/CHEZ-PASCAL-pascal-couv.jpg';
  assert.equal(cleanImageUrl(ok), ok);
});
