'use strict';

const MAX_IMAGE_BYTES = 900 * 1024;
const MAX_IMAGES_PER_USER = 300;
const ALLOWED = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

const SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP',
};

/**
 * Valide une image reçue sous forme de data URL ("data:image/jpeg;base64,...").
 * Vérifie le type annoncé, la taille et la signature réelle du fichier.
 */
const parseImageDataUrl = (value) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(value || ''));
  if (!match) return { error: 'IMAGE_FORMAT' };
  const contentType = match[1];
  const data = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!data.length) return { error: 'IMAGE_FORMAT' };
  if (data.length > MAX_IMAGE_BYTES) return { error: 'IMAGE_TOO_LARGE' };
  if (!SIGNATURES[contentType](data)) return { error: 'IMAGE_FORMAT' };
  return { contentType, data };
};

const IMAGE_MESSAGES = {
  IMAGE_FORMAT: 'Format d’image non pris en charge (JPEG, PNG ou WebP).',
  IMAGE_TOO_LARGE: 'Image trop lourde (900 Ko maximum).',
  IMAGE_QUOTA: 'Nombre maximum d’images atteint.',
};

module.exports = { MAX_IMAGE_BYTES, MAX_IMAGES_PER_USER, ALLOWED, parseImageDataUrl, IMAGE_MESSAGES };
