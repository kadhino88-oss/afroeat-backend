'use strict';

const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { createTicket, listMyTickets, listAllTickets, updateTicket } = require('../controllers/supportController');

const router = express.Router();

router.post('/tickets', protect, createTicket);
router.get('/tickets/mine', protect, listMyTickets);
router.get('/tickets', protect, allowRoles('admin'), listAllTickets);
router.patch('/tickets/:id', protect, allowRoles('admin'), updateTicket);

module.exports = router;
