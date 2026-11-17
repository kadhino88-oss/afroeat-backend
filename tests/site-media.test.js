const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSiteMedia } = require('../utils/siteMedia');

test('image de partage et plus grande icône, en adresses absolues https', () => {
  const html = `<html><head>
    <meta property="og:image" content="/img/cover.jpg?v=1&amp;x=2">
    <link rel="icon" href="/favicon.ico">
    <link rel="icon" sizes="32x32" href="/i32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="http://cdn.example.com/apple.png">
  </head></html>`;
  const media = extractSiteMedia(html, 'https://resto.example.com/fr/');
  assert.equal(media.imageUrl, 'https://resto.example.com/img/cover.jpg?v=1&x=2');
  assert.equal(media.logoUrl, 'https://cdn.example.com/apple.png');
});

test('rien d’inutilisable : SVG, .ico, icônes minuscules, javascript:', () => {
  const html = `<meta name="twitter:image" content="https://a.example/logo.svg">
    <link rel="icon" sizes="16x16" href="/x.png"><link rel="shortcut icon" href="/favicon.ico">
    <meta property="og:image" content="javascript:alert(1)">`;
  assert.deepEqual(extractSiteMedia(html, 'https://a.example/'), { imageUrl: '', logoUrl: '' });
});

test('les lieux exposent imageUrl et logoUrl', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../utils/placeSearch.js'), 'utf8');
  assert.match(src, /imageUrl: doc\.imageUrl \|\| ''/);
  assert.match(src, /logoUrl: doc\.logoUrl \|\| ''/);
});

test('un lieu repris par un partenaire visible n’est plus listé en double', async () => {
  const Place = require('../models/Place');
  const Restaurant = require('../models/Restaurant');
  const origAgg = Place.aggregate, origCount = Place.countDocuments, origFind = Restaurant.find;
  const claimed = '6afc7762a255f5f626a5f4f6';
  Place.aggregate = async () => [
    { osmKey: 'curated/x', kind: 'restaurant', name: 'Doublon', location: { coordinates: [6.2, 46.2] }, distanceMeters: 10, claimedRestaurant: claimed },
    { osmKey: 'n1', kind: 'restaurant', name: 'Autre', location: { coordinates: [6.2, 46.2] }, distanceMeters: 20 },
  ];
  Place.countDocuments = async () => 2;
  Restaurant.find = () => ({ select: () => ({ lean: async () => [{ _id: claimed }] }) });
  try {
    const { findStoredPlaces } = require('../utils/placeSearch');
    const out = await findStoredPlaces({ kind: 'restaurants', lat: 46.2, lng: 6.2, radiusKm: 5 });
    assert.deepEqual(out.items.map((i) => i.name), ['Autre']);
    assert.equal(out.total, 1);
  } finally {
    Place.aggregate = origAgg; Place.countDocuments = origCount; Restaurant.find = origFind;
  }
});
