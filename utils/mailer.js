'use strict';

/**
 * Envoi d'e-mails transactionnels via l'API REST de Resend.
 * Configuré par variables d'environnement (aucun secret dans le code) :
 *   RESEND_API_KEY  clé d'API
 *   MAIL_FROM       expéditeur vérifié, ex. "AfroEat <no-reply@afroeat.app>"
 * Sans configuration, l'envoi est simplement ignoré (reason: NOT_CONFIGURED).
 */
const sendMail = async ({ to, subject, text }, fetchImpl = fetch) => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.MAIL_FROM || '').trim();
  if (!apiKey || !from) return { sent: false, reason: 'NOT_CONFIGURED' };

  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      // Détail renvoyé par Resend (ex. « domaine non vérifié »), sans donnée sensible, pour diagnostiquer.
      let detail = '';
      try {
        const body = await response.json();
        detail = String(body?.message || body?.name || '').replace(/\s+/g, ' ').slice(0, 160);
      } catch {
        detail = '';
      }
      return { sent: false, reason: detail ? `HTTP_${response.status}: ${detail}` : `HTTP_${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' };
  }
};

module.exports = { sendMail };
