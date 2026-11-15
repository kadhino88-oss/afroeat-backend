'use strict';

const crypto = require('crypto');

/**
 * Chiffrement des pièces justificatives (AES-256-GCM).
 *
 * La clé vient de DOCUMENT_ENCRYPTION_KEY (64 caractères hexadécimaux = 32 octets). Sans clé
 * valide, aucun document n'est accepté : une pièce d'identité n'est jamais stockée en clair.
 */
const getKey = (env = process.env) => {
  const raw = String(env.DOCUMENT_ENCRYPTION_KEY || '').trim();
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
};

const isDocumentEncryptionConfigured = (env = process.env) => Boolean(getKey(env));

const encryptDocument = (plain, env = process.env) => {
  const key = getKey(env);
  if (!key) throw new Error('DOCUMENT_ENCRYPTION_KEY est absente ou invalide.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
};

const decryptDocument = ({ iv, tag, data }, env = process.env) => {
  const key = getKey(env);
  if (!key) throw new Error('DOCUMENT_ENCRYPTION_KEY est absente ou invalide.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()]);
};

module.exports = { isDocumentEncryptionConfigured, encryptDocument, decryptDocument };
