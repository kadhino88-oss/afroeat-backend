'use strict';

// Codes à usage unique basés sur le temps (RFC 6238), compatibles Google Authenticator,
// Microsoft Authenticator, 1Password, Authy… Aucune dépendance externe.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

const base32Decode = (text) => {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

const generateSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secret, counter) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
};

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

// Renvoie le pas de temps accepté (pour empêcher la réutilisation d'un code) ou null.
const verifyTotp = (secret, code, { now = Date.now(), window = 1, minStep = 0 } = {}) => {
  const candidate = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const step = currentStep(now);
  for (let delta = -window; delta <= window; delta += 1) {
    const s = step + delta;
    if (s <= minStep) continue;
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return s;
  }
  return null;
};

const otpauthUrl = (label, secret, issuer = 'AFROEAT') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

const generateBackupCodes = (count = 8) =>
  Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

const hashBackupCode = (code) =>
  crypto.createHash('sha256').update(String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

module.exports = { generateSecret, hotp, verifyTotp, currentStep, otpauthUrl, generateBackupCodes, hashBackupCode, base32Encode, base32Decode };
