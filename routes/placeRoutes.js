const express = require('express');
const { getNearbyPlaces, getNearbyGroceries } = require('../controllers/placeController');

const router = express.Router();

router.get('/nearby', getNearbyPlaces);
router.get('/groceries/nearby', getNearbyGroceries);

module.exports = router;
