'use strict';

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { encryptDocument, decryptDocument, isDocumentEncryptionConfigured } = require('../utils/documentCrypto');
const { generateSecret, verifyTotp, currentStep, otpauthUrl, generateBackupCodes, hashBackupCode } = require('../utils/totp');

const CHALLENGE_TTL = '5m';

const getSecret = () => process.env.JWT_SECRET;

const signChallenge = (user) => jwt.sign({ id: String(user._id), purpose: '2fa' }, getSecret(), { expiresIn: CHALLENGE_TTL });

const readSecret = (blob) => decryptDocument(blob).toString('utf8');
const storeSecret = (secret) => encryptDocument(Buffer.from(secret, 'utf8'));

// Vérifie un code (application d'authentification ou code de secours). Met à jour l'état anti-rejeu.
const checkCode = async (user, code) => {
  const tf = user.twoFactor || {};
  if (!tf.enabled || !tf.secret) return false;
  const step = verifyTotp(readSecret(tf.secret), code, { minStep: tf.lastStep || 0 });
  if (step) {
    user.twoFactor.lastStep = step;
    await user.save({ validateBeforeSave: false });
    return true;
  }
  const hash = hashBackupCode(code);
  if ((tf.backupCodeHashes || []).includes(hash)) {
    user.twoFactor.backupCodeHashes = tf.backupCodeHashes.filter((h) => h !== hash);
    await user.save({ validateBeforeSave: false });
    return true;
  }
  return false;
};

// POST /api/users/login/2fa — { challengeToken, code } → jeton de session
const completeLogin = (generateToken, formatUser) => async (req, res) => {
  try {
    let decoded;
    try {
      decoded = jwt.verify(String(req.body?.challengeToken || ''), getSecret());
    } catch {
      return res.status(401).json({ success: false, code: 'CHALLENGE_EXPIRED', message: 'Connexion expirée, recommence.' });
    }
    if (decoded?.purpose !== '2fa') return res.status(401).json({ success: false, message: 'Jeton invalide.' });

    const user = await User.findById(decoded.id).select('+twoFactor.secret +twoFactor.backupCodeHashes +twoFactor.lastStep');
    if (!user || user.role !== 'admin' || !(await checkCode(user, req.body?.code))) {
      return res.status(401).json({ success: false, code: 'CODE_INVALID', message: 'Code incorrect.' });
    }
    return res.json({ success: true, message: 'Connexion réussie', token: generateToken(user), user: formatUser(user) });
  } catch (error) {
    console.error('2FA login error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

const status = async (req, res) => {
  const user = await User.findById(req.user.id).select('twoFactor.enabled');
  res.json({ success: true, enabled: Boolean(user?.twoFactor?.enabled), available: isDocumentEncryptionConfigured() });
};

// POST /api/admin/2fa/setup — génère un secret en attente (non actif tant que non confirmé)
const setup = async (req, res) => {
  if (!isDocumentEncryptionConfigured()) {
    return res.status(503).json({ success: false, message: 'Chiffrement non configuré (DOCUMENT_ENCRYPTION_KEY).' });
  }
  const user = await User.findById(req.user.id).select('email twoFactor.enabled');
  if (user.twoFactor?.enabled) return res.status(409).json({ success: false, message: 'La double authentification est déjà active.' });
  const secret = generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.pendingSecret': storeSecret(secret) } });
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, secret, otpauthUrl: otpauthUrl(user.email, secret) });
};

// POST /api/admin/2fa/enable — { code } : confirme le secret et renvoie les codes de secours (une seule fois)
const enable = async (req, res) => {
  const user = await User.findById(req.user.id).select('+twoFactor.pendingSecret twoFactor.enabled');
  if (!user?.twoFactor?.pendingSecret) return res.status(400).json({ success: false, message: 'Lance d’abord la configuration.' });
  const secret = readSecret(user.twoFactor.pendingSecret);
  const step = verifyTotp(secret, req.body?.code);
  if (!step) return res.status(401).json({ success: false, code: 'CODE_INVALID', message: 'Code incorrect.' });
  const backupCodes = generateBackupCodes();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.secret': user.twoFactor.pendingSecret,
        'twoFactor.pendingSecret': null,
        'twoFactor.lastStep': step,
        'twoFactor.backupCodeHashes': backupCodes.map(hashBackupCode),
        'twoFactor.enabledAt': new Date(),
      },
    }
  );
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, backupCodes });
};

// POST /api/admin/2fa/disable — { password, code }
const disable = async (req, res) => {
  const user = await User.findById(req.user.id).select('+password +twoFactor.secret +twoFactor.backupCodeHashes +twoFactor.lastStep');
  if (!user?.twoFactor?.enabled) return res.json({ success: true });
  if (!(await user.matchPassword(String(req.body?.password || ''))) || !(await checkCode(user, req.body?.code))) {
    return res.status(401).json({ success: false, code: 'CODE_INVALID', message: 'Mot de passe ou code incorrect.' });
  }
  await User.updateOne({ _id: user._id }, { $set: { twoFactor: { enabled: false } } });
  return res.json({ success: true });
};

module.exports = { signChallenge, completeLogin, status, setup, enable, disable, checkCode };
