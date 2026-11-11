'use strict';

const mongoose = require('mongoose');
const UploadedImage = require('../models/UploadedImage');
const { parseImageDataUrl, IMAGE_MESSAGES, MAX_IMAGES_PER_USER } = require('../utils/imageUpload');

const publicBase = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
};

/** POST /api/images — { dataUrl } -> { url } (restaurant, admin). */
const uploadImage = async (req, res) => {
  try {
    const parsed = parseImageDataUrl(req.body?.dataUrl);
    if (parsed.error) {
      return res.status(parsed.error === 'IMAGE_TOO_LARGE' ? 413 : 422).json({
        success: false,
        code: parsed.error,
        message: IMAGE_MESSAGES[parsed.error],
      });
    }
    const count = await UploadedImage.countDocuments({ owner: req.user._id });
    if (count >= MAX_IMAGES_PER_USER) {
      return res.status(409).json({ success: false, code: 'IMAGE_QUOTA', message: IMAGE_MESSAGES.IMAGE_QUOTA });
    }
    const image = await UploadedImage.create({
      owner: req.user._id,
      contentType: parsed.contentType,
      data: parsed.data,
      size: parsed.data.length,
    });
    return res.status(201).json({
      success: true,
      id: String(image._id),
      url: `${publicBase(req)}/api/images/${image._id}`,
    });
  } catch (error) {
    console.error('Upload image error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** GET /api/images/:id — public, mis en cache (les images sont immuables). */
const getImage = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
      return res.status(404).json({ success: false, message: 'Image introuvable.' });
    }
    const image = await UploadedImage.findById(req.params.id).select('contentType data');
    if (!image) return res.status(404).json({ success: false, message: 'Image introuvable.' });
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(image.data);
  } catch (error) {
    console.error('Get image error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = { uploadImage, getImage };
