const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

const { deleteMyAccount, exportMyData, accountDeletionPage, listAddresses, createAddress, deleteAddress } = require('../controllers/accountController');

const {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  changePassword,
  forgotPassword,
  resetPassword,
  getDrivers,
  generateToken,
  formatUser,
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
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});
router.post('/login', loginUser);
router.post('/login/2fa', loginLimiter, require('../controllers/twoFactorController').completeLogin(generateToken, formatUser));
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

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
router.get('/account-deletion', accountDeletionPage);
router.get('/me', protect, getMe);
router.get('/me/export', protect, exportMyData);
router.delete('/me/account', protect, deleteMyAccount);
router.get('/me/referral', protect, allowRoles('client'), require('../controllers/promoController').getMyReferral);
router.get('/me/addresses', protect, allowRoles('client'), listAddresses);
router.post('/me/addresses', protect, allowRoles('client'), createAddress);
router.delete('/me/addresses/:id', protect, allowRoles('client'), deleteAddress);
router.put('/me', protect, updateMe);
router.put('/me/password', protect, changePassword);

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