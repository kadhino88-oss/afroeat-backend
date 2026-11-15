'use strict';

// Commandes restées sans suite : annulées automatiquement (et remboursées si déjà payées).
const { refundCancelledOrder } = require('./orderRefund');

const DEFAULTS = {
  acceptTimeoutMin: Number(process.env.ORDER_ACCEPT_TIMEOUT_MIN) || 15, // payée, restaurant sans réponse
  unpaidTimeoutMin: Number(process.env.ORDER_UNPAID_TIMEOUT_MIN) || 60, // paiement jamais finalisé
};

const AUTO_NOTE_UNANSWERED = 'Annulée automatiquement : le restaurant n’a pas répondu à temps.';
const AUTO_NOTE_UNPAID = 'Annulée automatiquement : paiement non finalisé.';

const cancel = async (order, note) => {
  order.status = 'Annulée';
  if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
  order.statusHistory.push({ status: 'Annulée', updatedBy: null, updatedByRole: 'system', note });
  await order.save();
};

const expireStaleOrders = async ({ Order, stripe, now = Date.now(), notify = async () => {}, ...limits } = {}) => {
  const { acceptTimeoutMin, unpaidTimeoutMin } = { ...DEFAULTS, ...limits };
  const result = { unanswered: 0, unpaid: 0, refunded: 0 };

  const unanswered = await Order.find({
    status: 'En attente',
    paymentStatus: 'Payé',
    createdAt: { $lt: new Date(now - acceptTimeoutMin * 60000) },
  }).limit(50);
  for (const order of unanswered) {
    await cancel(order, AUTO_NOTE_UNANSWERED);
    result.unanswered += 1;
    const r = await refundCancelledOrder(order, stripe);
    if (r.refunded) result.refunded += 1;
    await notify(order, 'unanswered');
  }

  const unpaid = await Order.find({
    status: 'En attente',
    paymentStatus: 'Non payé',
    paymentMethod: { $ne: 'cash' },
    createdAt: { $lt: new Date(now - unpaidTimeoutMin * 60000) },
  }).limit(50);
  for (const order of unpaid) {
    await cancel(order, AUTO_NOTE_UNPAID);
    result.unpaid += 1;
  }

  return result;
};

// Déclenchement opportuniste (au plus une fois par minute et par instance) : pas de tâche planifiée requise.
let lastRun = 0;
const maybeExpireStaleOrders = async (deps, minIntervalMs = 60000) => {
  if (Date.now() - lastRun < minIntervalMs) return null;
  lastRun = Date.now();
  try {
    return await expireStaleOrders(deps);
  } catch (error) {
    console.error('Annulation des commandes en attente :', error.message);
    return null;
  }
};

module.exports = { expireStaleOrders, maybeExpireStaleOrders, DEFAULTS };
