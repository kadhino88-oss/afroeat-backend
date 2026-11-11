'use strict';

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { uploadImage, getImage } = require('../controllers/imageController');

const router = express.Router();

router.post('/', protect, allowRoles('restaurant', 'admin'), uploadImage);
router.get('/:id', getImage);

module.exports = router;
