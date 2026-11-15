'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const VerificationDocument = require('../models/VerificationDocument');
const VerificationFile = require('../models/VerificationFile');
const { parseImageDataUrl, IMAGE_MESSAGES } = require('../utils/imageUpload');
const {
  isDocumentEncryptionConfigured,
  encryptDocument,
  decryptDocument,
} = require('../utils/documentCrypto');
const {
  PENDING_RETENTION_DAYS,
  DECIDED_RETENTION_DAYS,
  getRequiredKinds,
  expiryAfterDays,
  isFullyApproved,
} = require('../utils/verificationRules');
const { createAuditLog } = require('./adminAuditController');

// La production désactive la création automatique des index : sans l'index d'expiration,
// les fichiers ne seraient jamais effacés. On le crée donc avant le premier envoi.
let fileIndexesReady = null;
const ensureFileIndexes = () => {
  if (!fileIndexesReady) {
    fileIndexesReady = VerificationFile.createIndexes().catch((error) => {
      fileIndexesReady = null;
      throw error;
    });
  }
  return fileIndexesReady;
};

const isValidId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const toPublicDocument = (doc) => ({
  id: String(doc._id),
  kind: doc.kind,
  status: doc.status,
  createdAt: doc.createdAt,
  reviewedAt: doc.reviewedAt,
  rejectionReason: doc.rejectionReason || '',
  fileExpiresAt: doc.fileExpiresAt,
});

/** Dernière pièce envoyée pour chaque type. */
const latestByKind = (documents) => {
  const latest = new Map();
  for (const doc of documents) {
    if (!latest.has(doc.kind)) latest.set(doc.kind, doc);
  }
  return [...latest.values()];
};

const notConfigured = (res) =>
  res.status(503).json({
    success: false,
    code: 'VERIFICATION_NOT_CONFIGURED',
    message: 'L’envoi de documents n’est pas encore disponible.',
  });

/** GET /api/verification/me — pièces demandées et état de chacune. */
const getMyVerification = async (req, res) => {
  try {
    const required = getRequiredKinds(req.user.role);
    const documents = latestByKind(
      await VerificationDocument.find({ user: req.user._id }).sort({ createdAt: -1 })
    );
    return res.json({
      success: true,
      available: isDocumentEncryptionConfigured(),
      required,
      documents: documents.map(toPublicDocument),
      verified: isFullyApproved(req.user.role, documents),
      retention: { pendingDays: PENDING_RETENTION_DAYS, decidedDays: DECIDED_RETENTION_DAYS },
    });
  } catch (error) {
    console.error('Get verification error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** POST /api/verification/documents — { kind, dataUrl, consent: true }. */
const uploadMyDocument = async (req, res) => {
  try {
    if (!isDocumentEncryptionConfigured()) return notConfigured(res);

    const kind = String(req.body?.kind || '').trim();
    if (!getRequiredKinds(req.user.role).includes(kind)) {
      return res.status(400).json({ success: false, code: 'DOCUMENT_KIND', message: 'Type de document non demandé.' });
    }
    if (req.body?.consent !== true) {
      return res.status(400).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'Ton accord est nécessaire pour envoyer ce document.',
      });
    }

    const parsed = parseImageDataUrl(req.body?.dataUrl);
    if (parsed.error) {
      return res.status(parsed.error === 'IMAGE_TOO_LARGE' ? 413 : 422).json({
        success: false,
        code: parsed.error,
        message: IMAGE_MESSAGES[parsed.error],
      });
    }

    const previous = await VerificationDocument.find({ user: req.user._id, kind });
    if (previous.some((doc) => doc.status === 'approved')) {
      return res.status(409).json({
        success: false,
        code: 'DOCUMENT_ALREADY_APPROVED',
        message: 'Ce document est déjà validé.',
      });
    }

    await ensureFileIndexes();

    const fileExpiresAt = expiryAfterDays(PENDING_RETENTION_DAYS);
    const document = await VerificationDocument.create({
      user: req.user._id,
      kind,
      contentType: parsed.contentType,
      size: parsed.data.length,
      consentAt: new Date(),
      fileExpiresAt,
    });

    try {
      const encrypted = encryptDocument(parsed.data);
      await VerificationFile.create({ document: document._id, ...encrypted, expiresAt: fileExpiresAt });
    } catch (fileError) {
      await VerificationDocument.deleteOne({ _id: document._id }).catch(() => {});
      throw fileError;
    }

    // Une nouvelle pièce remplace les précédentes du même type (en attente ou refusées).
    const replaced = previous.map((doc) => doc._id);
    if (replaced.length) {
      await VerificationFile.deleteMany({ document: { $in: replaced } });
      await VerificationDocument.deleteMany({ _id: { $in: replaced } });
    }

    return res.status(201).json({ success: true, document: toPublicDocument(document) });
  } catch (error) {
    console.error('Upload verification document error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** DELETE /api/verification/documents/:id — le partenaire retire une pièce non validée. */
const deleteMyDocument = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Document introuvable.' });
    const document = await VerificationDocument.findOne({ _id: req.params.id, user: req.user._id });
    if (!document) return res.status(404).json({ success: false, message: 'Document introuvable.' });
    if (document.status === 'approved') {
      return res.status(409).json({
        success: false,
        code: 'DOCUMENT_ALREADY_APPROVED',
        message: 'Un document validé ne peut pas être retiré ici. Écris au support.',
      });
    }
    await VerificationFile.deleteOne({ document: document._id });
    await VerificationDocument.deleteOne({ _id: document._id });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete verification document error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const audit = async (req, action, document, owner, details, metadata = {}) => {
  try {
    await createAuditLog({
      adminId: req.user._id,
      action,
      targetType: owner?.role === 'livreur' ? 'driver' : 'user',
      targetId: owner?._id || document.user,
      targetLabel: `${owner?.name || ''} <${owner?.email || ''}>`,
      details,
      metadata: { documentId: String(document._id), kind: document.kind, ...metadata },
      ipAddress: String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
    });
  } catch (error) {
    console.error('Verification audit error:', error.message);
  }
};

/** ADMIN — GET /api/admin/verification?status=pending */
const listDocuments = async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query?.status))
      ? String(req.query.status)
      : 'pending';
    const documents = await VerificationDocument.find({ status })
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .limit(100)
      .populate('user', 'name email role phone');
    const fileIds = new Set(
      (await VerificationFile.find({ document: { $in: documents.map((d) => d._id) } }).select('document'))
        .map((file) => String(file.document))
    );
    return res.json({
      success: true,
      items: documents.map((doc) => ({
        ...toPublicDocument(doc),
        fileAvailable: fileIds.has(String(doc._id)),
        user: doc.user
          ? { id: String(doc.user._id), name: doc.user.name, email: doc.user.email, role: doc.user.role, phone: doc.user.phone || '' }
          : null,
      })),
    });
  } catch (error) {
    console.error('List verification documents error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** ADMIN — GET /api/admin/verification/:id/file : la pièce déchiffrée, chaque consultation est tracée. */
const getDocumentFile = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Document introuvable.' });
    const document = await VerificationDocument.findById(req.params.id).populate('user', 'name email role');
    if (!document) return res.status(404).json({ success: false, message: 'Document introuvable.' });
    const file = await VerificationFile.findOne({ document: document._id });
    if (!file) {
      return res.status(410).json({
        success: false,
        code: 'DOCUMENT_FILE_DELETED',
        message: 'Le fichier a été effacé (durée de conservation dépassée).',
      });
    }
    const plain = decryptDocument(file);
    await audit(req, 'view_verification_document', document, document.user, 'Consultation d’une pièce justificative.');
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      dataUrl: `data:${document.contentType};base64,${plain.toString('base64')}`,
    });
  } catch (error) {
    console.error('Get verification file error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** ADMIN — PATCH /api/admin/verification/:id { decision: 'approved' | 'rejected', reason } */
const reviewDocument = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Document introuvable.' });
    const decision = String(req.body?.decision || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision invalide.' });
    }
    if (decision === 'rejected' && reason.length < 3) {
      return res.status(400).json({ success: false, message: 'Indique le motif du refus.' });
    }

    const fileExpiresAt = expiryAfterDays(DECIDED_RETENTION_DAYS);
    const document = await VerificationDocument.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      {
        status: decision,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        rejectionReason: decision === 'rejected' ? reason : '',
        fileExpiresAt,
      },
      { new: true }
    );
    if (!document) {
      return res.status(409).json({ success: false, message: 'Ce document a déjà été traité.' });
    }
    await VerificationFile.updateOne({ document: document._id }, { expiresAt: fileExpiresAt });

    const owner = await User.findById(document.user);
    let verified = false;
    if (owner && decision === 'approved') {
      const all = await VerificationDocument.find({ user: owner._id });
      const approved = (kind) => all.some((doc) => doc.kind === kind && doc.status === 'approved');
      verified = isFullyApproved(owner.role, all);
      if (owner.role === 'livreur') {
        owner.isIdentityVerified = approved('identity');
        owner.isWorkAuthorized = approved('work_permit');
      } else if (verified) {
        owner.isIdentityVerified = true;
        owner.isWorkAuthorized = true;
      }
      await owner.save();
    }

    await audit(
      req,
      decision === 'approved' ? 'approve_verification_document' : 'reject_verification_document',
      document,
      owner,
      decision === 'approved' ? 'Pièce justificative acceptée.' : `Pièce justificative refusée : ${reason}`,
      { verified }
    );

    return res.json({ success: true, document: toPublicDocument(document), verified });
  } catch (error) {
    console.error('Review verification document error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = {
  getMyVerification,
  uploadMyDocument,
  deleteMyDocument,
  listDocuments,
  getDocumentFile,
  reviewDocument,
};
