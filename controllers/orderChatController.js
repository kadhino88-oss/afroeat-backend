'use strict';

const OrderMessage = require('../models/OrderMessage');
const { sendPushToUser } = require('../utils/pushNotifications');
const { isChatOpen, cleanMessage, firstName, recipientsFor } = require('../utils/orderChat');

const ROLES = ['client', 'livreur', 'restaurant', 'admin'];

/** GET /api/orders/:id/messages — participants de la commande uniquement (canAccessOrder). */
const listOrderMessages = async (req, res) => {
  try {
    const messages = await OrderMessage.find({ order: req.order._id })
      .sort({ createdAt: 1 })
      .limit(200)
      .select('sender senderRole senderName text createdAt')
      .lean();
    return res.json({
      success: true,
      open: isChatOpen(req.order),
      me: String(req.user._id),
      messages,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/** POST /api/orders/:id/messages { text } */
const postOrderMessage = async (req, res) => {
  try {
    if (!isChatOpen(req.order)) {
      return res.status(409).json({ success: false, code: 'CHAT_CLOSED', message: 'La discussion de cette commande est terminée.' });
    }
    const text = cleanMessage(req.body?.text);
    if (!text) {
      return res.status(400).json({ success: false, code: 'EMPTY_MESSAGE', message: 'Le message est vide.' });
    }
    const role = ROLES.includes(req.user.role) ? req.user.role : 'client';
    const message = await OrderMessage.create({
      order: req.order._id,
      sender: req.user._id,
      senderRole: role,
      senderName: firstName(req.user.name),
      text,
    });

    const ref = String(req.order._id).slice(-6).toUpperCase();
    await Promise.allSettled(
      recipientsFor(req.order, req.user._id).map((userId) =>
        sendPushToUser(userId, {
          title: `Message · commande #${ref}`,
          body: text.length > 120 ? `${text.slice(0, 117)}…` : text,
          data: { orderId: String(req.order._id), type: 'order_message' },
        })
      )
    );

    return res.status(201).json({ success: true, message });
  } catch (error) {
    console.error('Order chat error:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = { listOrderMessages, postOrderMessage };
