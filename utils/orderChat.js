'use strict';

/** La discussion reste ouverte pendant la commande et 2 heures après la livraison ou l'annulation. */
const CHAT_GRACE_MS = 2 * 60 * 60 * 1000;
const CLOSED = ['Livrée', 'Annulée'];

const isChatOpen = (order, now = Date.now()) => {
  if (!order) return false;
  if (!CLOSED.includes(order.status)) return true;
  const closedAt = new Date(order.deliveredAt || order.updatedAt || 0).getTime();
  return Boolean(closedAt) && now - closedAt < CHAT_GRACE_MS;
};

const cleanMessage = (value) =>
  String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, 500);

/** Prénom seulement, pour ne pas exposer le nom complet aux autres participants. */
const firstName = (name) => String(name || '').trim().split(/\s+/)[0]?.slice(0, 30) || '';

/** Destinataires d'un message : tous les participants de la commande sauf l'expéditeur. */
const recipientsFor = (order, senderId) =>
  [order.user, order.deliveryPerson, order.restaurant?.owner]
    .filter(Boolean)
    .map(String)
    .filter((id, i, list) => id !== String(senderId) && list.indexOf(id) === i);

module.exports = { CHAT_GRACE_MS, isChatOpen, cleanMessage, firstName, recipientsFor };
