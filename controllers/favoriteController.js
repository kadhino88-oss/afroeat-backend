'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const MAX_FAVORITES = 200;

/** GET /api/users/me/favorites — restaurants favoris du client connecté. */
const listFavorites = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('favoriteRestaurants').lean();
    const ids = Array.isArray(user?.favoriteRestaurants) ? user.favoriteRestaurants : [];
    const restaurants = ids.length
      ? await Restaurant.find({ _id: { $in: ids }, isActive: { $ne: false } })
          .select('_id name description cuisine image coverImage address city isOpen businessType')
          .lean()
      : [];
    return res.json({ success: true, restaurants });
  } catch (error) {
    console.error('List favorites error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** PUT /api/users/me/favorites/:id — ajoute un restaurant (idempotent). */
const addFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Restaurant invalide.' });
    if (!(await Restaurant.exists({ _id: id }))) {
      return res.status(404).json({ success: false, message: 'Restaurant introuvable.' });
    }
    const user = await User.findById(req.user._id).select('favoriteRestaurants');
    const list = Array.isArray(user.favoriteRestaurants) ? user.favoriteRestaurants : [];
    if (!list.some((value) => String(value) === String(id))) {
      if (list.length >= MAX_FAVORITES) {
        return res.status(409).json({ success: false, message: 'Trop de favoris.' });
      }
      await User.updateOne({ _id: req.user._id }, { $addToSet: { favoriteRestaurants: id } });
    }
    return res.json({ success: true, favorite: true });
  } catch (error) {
    console.error('Add favorite error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** DELETE /api/users/me/favorites/:id */
const removeFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: 'Restaurant invalide.' });
    await User.updateOne({ _id: req.user._id }, { $pull: { favoriteRestaurants: id } });
    return res.json({ success: true, favorite: false });
  } catch (error) {
    console.error('Remove favorite error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = { listFavorites, addFavorite, removeFavorite, MAX_FAVORITES };
