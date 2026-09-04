const { Expo } = require('expo-server-sdk');

const User = require('../models/User');

/**
 * =========================================================
 * PUSH NOTIFICATIONS — AFROEAT
 * =========================================================
 *
 * Envoie une notification push Expo à un utilisateur.
 * - Ne bloque jamais l'appelant : les erreurs sont loguées,
 *   jamais propagées (une notif ratée ne doit pas faire
 *   échouer une mise à jour de commande).
 * - Vérifie que le pushToken stocké est bien un token Expo
 *   valide avant d'essayer de l'utiliser.
 */

const expo = new Expo();

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ title: string, body: string, data?: object }} payload
 */
const sendPushToUser = async (userId, { title, body, data = {} } = {}) => {
  try {
    if (!userId || !title || !body) {
      return;
    }

    const user = await User.findById(userId).select('pushToken');
    const token = user?.pushToken;

    if (!token || !Expo.isExpoPushToken(token)) {
      return;
    }

    const messages = [
      {
        to: token,
        sound: 'default',
        title,
        body,
        data,
      },
    ];

    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error('Erreur envoi notification push (chunk) :', error);
      }
    }
  } catch (error) {
    console.error('Erreur sendPushToUser :', error);
  }
};

module.exports = { sendPushToUser };
