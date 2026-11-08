'use strict';

const PartnerApplication = require('../models/PartnerApplication');
const { validateApplication, STATUSES } = require('../utils/partnerApplication');

const createApplication = async (req, res) => {
  try {
    // Champ piège invisible : un robot le remplit, un humain non. On répond « OK » sans rien enregistrer.
    if (String(req.body?.company || '').trim()) {
      return res.status(201).json({ success: true, message: 'Demande reçue.' });
    }

    const data = validateApplication(req.body);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const duplicate = await PartnerApplication.findOne({
      email: data.email,
      businessName: data.businessName,
      createdAt: { $gte: since },
    }).select('_id');

    if (duplicate) {
      return res.status(200).json({ success: true, message: 'Demande déjà reçue, nous revenons vers toi.' });
    }

    await PartnerApplication.create(data);
    return res.status(201).json({ success: true, message: 'Demande reçue. Nous te contactons très vite.' });
  } catch (error) {
    const isValidation = /obligatoire|invalide|commencer par/.test(error.message || '');
    if (!isValidation) console.error('Partner application error:', error.message);
    return res.status(isValidation ? 400 : 500).json({
      success: false,
      message: isValidation ? error.message : 'Erreur serveur.',
    });
  }
};

const listApplications = async (req, res) => {
  try {
    const status = String(req.query.status || '');
    const filter = STATUSES.includes(status) ? { status } : {};
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const [items, total] = await Promise.all([
      PartnerApplication.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PartnerApplication.countDocuments(filter),
    ]);

    return res.json({ success: true, total, page, limit, applications: items });
  } catch (error) {
    console.error('List partner applications error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

const updateApplication = async (req, res) => {
  try {
    const update = {};
    if (req.body?.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ success: false, message: 'Statut invalide.' });
      }
      update.status = req.body.status;
    }
    if (req.body?.adminNote !== undefined) {
      update.adminNote = String(req.body.adminNote).trim().slice(0, 1000);
    }

    const application = await PartnerApplication.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!application) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    return res.json({ success: true, application });
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Identifiant invalide.' });
  }
};

module.exports = { createApplication, listApplications, updateApplication };
