const express = require('express');

const router = express.Router();

const {
  getRestaurants,
  getNearbyRestaurants,
  getMyRestaurant,
  getRestaurantById,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
} = require('../controllers/restaurantController');

const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

/**
 * =========================================================
 * RESTAURANT ROUTES
 * =========================================================
 */

router.get('/', getRestaurants);

router.get('/nearby', getNearbyRestaurants);

router.get(
  '/my',
  protect,
  allowRoles('restaurant', 'admin'),
  getMyRestaurant
);

router.get('/:id', getRestaurantById);

router.post(
  '/',
  protect,
  allowRoles('restaurant', 'admin'),
  createRestaurant
);

router.put(
  '/:id',
  protect,
  allowRoles('restaurant', 'admin'),
  updateRestaurant
);

router.delete(
  '/:id',
  protect,
  allowRoles('restaurant', 'admin'),
  deleteRestaurant
);

module.exports = router;