const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

const {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  getDrivers,
} = require('../controllers/userController');

/**
 * =========================================================
 * USER ROUTES — VERSION FINALE ROBUSTE
 * =========================================================
 *
 * Objectifs :
 * - séparer clairement auth / protection / métier
 * - éviter de laisser les middlewares dans le controller
 * - préparer une structure propre multi-rôles AFROEAT
 */

/**
 * =========================================================
 * AUTH PUBLIC
 * =========================================================
 */
router.post('/register', registerUser);
router.post('/login', loginUser);

/**
 * =========================================================
 * SELF ACCOUNT
 * =========================================================
 *
 * GET /api/users/me
 * PUT /api/users/me
 *
 * Accessible à tout utilisateur authentifié.
 */
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);

// Favoris du client
const { listFavorites, addFavorite, removeFavorite } = require('../controllers/favoriteController');
router.get('/me/favorites', protect, allowRoles('client'), listFavorites);
router.put('/me/favorites/:id', protect, allowRoles('client'), addFavorite);
router.delete('/me/favorites/:id', protect, allowRoles('client'), removeFavorite);

/**
 * =========================================================
 * DRIVERS DIRECTORY
 * =========================================================
 *
 * GET /api/users/drivers
 *
 * Accessible à :
 * - admin
 * - restaurant
 *
 * Permet de récupérer des livreurs disponibles / actifs
 * pour assignation ou supervision.
 */
router.get(
  '/drivers',
  protect,
  allowRoles('admin', 'restaurant'),
  getDrivers
);

module.exports = router;