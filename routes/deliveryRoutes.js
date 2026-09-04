const express = require('express');

const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const {
  getMyDeliveryProfile,
  getAssignedDeliveryOrders,
  getCurrentDeliveryOrder,
  getDeliveryOrderById,
  updateMyAvailability,
  updateMyLocation,
  updateDeliveryMissionStatus,
  getDeliveryOverview,
  getMyDeliveryEarnings,
  getMyDeliveryStats,
} = require('../controllers/deliveryController');

/**
 * =========================================================
 * DELIVERY ROUTES
 * =========================================================
 * Bloc livreur premium AFROEAT
 * - profil livreur
 * - overview opérationnel
 * - stats livreur
 * - earnings
 * - commandes assignées
 * - mission active
 * - détail mission
 * - disponibilité
 * - position GPS live
 * - mise à jour statut mission
 */

router.use(protect);
router.use(allowRoles('livreur', 'admin'));

/**
 * Driver profile / ops overview
 */
router.get('/profile', getMyDeliveryProfile);
router.get('/overview', getDeliveryOverview);
router.get('/stats', getMyDeliveryStats);
router.get('/earnings', getMyDeliveryEarnings);

/**
 * Delivery missions / orders
 */
router.get('/orders', getAssignedDeliveryOrders);
router.get('/current-order', getCurrentDeliveryOrder);
router.get('/orders/:id', getDeliveryOrderById);
router.put('/orders/:id/status', updateDeliveryMissionStatus);

/**
 * Driver live state
 */
router.put('/availability', updateMyAvailability);
router.put('/location', updateMyLocation);

module.exports = router;