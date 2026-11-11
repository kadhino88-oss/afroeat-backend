'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseImageDataUrl, MAX_IMAGE_BYTES } = require('../utils/imageUpload');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const url = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;

test('accepte un PNG et un JPEG valides', () => {
  assert.equal(parseImageDataUrl(url('image/png', png)).contentType, 'image/png');
  assert.equal(parseImageDataUrl(url('image/jpeg', jpg)).contentType, 'image/jpeg');
});

test('refuse un fichier dont le contenu ne correspond pas au type annoncé', () => {
  assert.equal(parseImageDataUrl(url('image/png', jpg)).error, 'IMAGE_FORMAT');
  assert.equal(parseImageDataUrl(url('image/jpeg', Buffer.from('<svg onload=alert(1)>'))).error, 'IMAGE_FORMAT');
});

test('refuse SVG, HTML et texte arbitraire', () => {
  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zy8+').error, 'IMAGE_FORMAT');
  assert.equal(parseImageDataUrl('data:text/html;base64,PGgxPg==').error, 'IMAGE_FORMAT');
  assert.equal(parseImageDataUrl('https://exemple.ch/a.png').error, 'IMAGE_FORMAT');
  assert.equal(parseImageDataUrl('').error, 'IMAGE_FORMAT');
});

test('refuse une image trop lourde', () => {
  const big = Buffer.concat([jpg, Buffer.alloc(MAX_IMAGE_BYTES)]);
  assert.equal(parseImageDataUrl(url('image/jpeg', big)).error, 'IMAGE_TOO_LARGE');
});

test('routes : envoi réservé aux restaurateurs et admins, lecture publique', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'imageRoutes.js'), 'utf8');
  assert.match(src, /router\.post\('\/', protect, allowRoles\('restaurant', 'admin'\), uploadImage\)/);
  assert.match(src, /router\.get\('\/:id', getImage\)/);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/images'/);
});
