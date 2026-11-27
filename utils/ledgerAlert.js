'use strict';

// Alerte e-mail du rapprochement quotidien du ledger. À ÉCHEC OUVERT : aucune fonction exportée ne lève
// d'exception, et l'appelant ne doit jamais modifier sa réponse selon le résultat.
//
// - Destinataire : ALERT_EMAIL, sinon PARTNER_NOTIFY_EMAIL, sinon rien (aucun envoi, aucun accès base).
// - Déclenché pour le statut « mismatch » ou lorsque le rapprochement échoue (« failed »), jamais pour « ok ».
// - Un seul e-mail par période et par statut : le rapport (LedgerReconciliationReport, qui n'est PAS le
//   ledger immuable) porte alertedStatus / alertSentAt, posés par une mise à jour conditionnelle atomique
//   AVANT l'envoi (deux exécutions simultanées ne peuvent pas envoyer deux fois) puis retirés si l'envoi échoue,
//   pour qu'une relance puisse réessayer.
// - Corps : période, nombre d'écarts par type, totaux ledger / Stripe par devise. Aucune donnée personnelle,
//   aucun identifiant (commande, Stripe), aucun montant par client.

const mailer = require('./mailer');
const { isValidEmailAddress } = require('./emailValidation');
const { fromMinorUnits } = require('./currency');

const ALERT_STATUSES = Object.freeze(['mismatch', 'failed']);
const MAX_LINES = 40;

// Jeton affichable : lettres, chiffres et _ uniquement, longueur bornée (valeurs venant de Stripe / de la base).
const safeToken = (value, max = 32) => {
  let out = '';
  for (const char of String(value ?? '').slice(0, max)) {
    const code = char.charCodeAt(0);
    const ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
    out += ok ? char : '?';
  }
  return out;
};

const resolveRecipient = (env = process.env) => {
  for (const name of ['ALERT_EMAIL', 'PARTNER_NOTIFY_EMAIL']) {
    const candidate = String(env[name] || '').trim();
    if (candidate && isValidEmailAddress(candidate)) return candidate;
  }
  return null;
};

const formatAmount = (minor, currency) => {
  const value = fromMinorUnits(minor, currency);
  return value === null ? 'n/a' : value.toFixed(2);
};

// Net par devise (somme de toutes les lignes d'une liste de totaux { type, currency, totalMinor }).
const netByCurrency = (rows) => {
  const net = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const currency = safeToken(row?.currency, 8).toUpperCase() || 'N/A';
    net.set(currency, (net.get(currency) || 0) + (Number(row?.totalMinor) || 0));
  }
  return net;
};

/**
 * Construit le texte de l'alerte (fonction pure, testable).
 * @param {{ kind: 'mismatch'|'failed', period: {from: Date, to: Date}, countsByKind?: object, discrepancyCount?: number,
 *   truncated?: boolean, stripeComplete?: boolean, ledgerTotals?: object[], stripeTotals?: object[] }} input
 */
const buildAlertEmail = ({ kind, period, countsByKind = {}, discrepancyCount = 0, truncated = false, stripeComplete = true, ledgerTotals = [], stripeTotals = [] }) => {
  const from = period?.from instanceof Date ? period.from.toISOString() : 'n/a';
  const to = period?.to instanceof Date ? period.to.toISOString() : 'n/a';
  const lines = [];

  if (kind === 'failed') {
    lines.push('Le rapprochement quotidien du ledger a échoué et n\'a pas pu produire de rapport complet.');
    lines.push('Vérifier les journaux du serveur (nom / code d\'erreur seulement) et relancer le job.');
  } else {
    lines.push('Le rapprochement quotidien du ledger a détecté des écarts. Rien n\'a été corrigé automatiquement.');
    lines.push(`Écarts : ${Number(discrepancyCount) || 0}${truncated ? ' (liste tronquée, comptes partiels)' : ''}`);
    if (!stripeComplete) lines.push('Données Stripe incomplètes ou indisponibles pour cette période.');

    const kinds = Object.entries(countsByKind).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_LINES);
    if (kinds.length) {
      lines.push('', 'Écarts par type :');
      for (const [name, count] of kinds) lines.push(`- ${safeToken(name, 48)} : ${Number(count) || 0}`);
    }

    const ledgerNet = netByCurrency(ledgerTotals);
    const stripeNet = netByCurrency(stripeTotals);
    const currencies = [...new Set([...ledgerNet.keys(), ...stripeNet.keys()])].sort().slice(0, MAX_LINES);
    if (currencies.length) {
      lines.push('', 'Totaux nets par devise (ledger / Stripe) :');
      for (const currency of currencies) {
        const ledgerMinor = ledgerNet.get(currency) || 0;
        const stripeMinor = stripeNet.get(currency) || 0;
        lines.push(`- ${currency} : ledger ${formatAmount(ledgerMinor, currency)} / Stripe ${formatAmount(stripeMinor, currency)} (écart ${formatAmount(ledgerMinor - stripeMinor, currency)})`);
      }
    }
  }

  lines.push('', `Période : ${from} -> ${to} (UTC, [début, fin[)`, 'Détails : rapport LedgerReconciliationReport de cette période (base de données).');
  return {
    subject: kind === 'failed'
      ? `[AfroEat] Rapprochement du ledger en échec - ${from.slice(0, 10)}`
      : `[AfroEat] Écarts de rapprochement du ledger - ${from.slice(0, 10)}`,
    text: lines.join('\n'),
  };
};

/**
 * Envoie (au plus une fois par période et par statut) l'alerte. Ne lève JAMAIS.
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
const sendReconciliationAlert = async (input, { ReportModel, env = process.env, now = () => new Date() } = {}) => {
  let claimed = false;
  const kind = input?.kind;
  const period = input?.period;
  try {
    if (!ALERT_STATUSES.includes(kind)) return { sent: false, reason: 'NOT_ALERTABLE' };
    const to = resolveRecipient(env);
    if (!to) return { sent: false, reason: 'NO_RECIPIENT' };
    if (!(period?.from instanceof Date) || !(period?.to instanceof Date)) return { sent: false, reason: 'NO_PERIOD' };

    const key = { periodStart: period.from, periodEnd: period.to };
    try {
      const claim = await ReportModel.updateOne(
        { ...key, alertedStatus: { $ne: kind } },
        { $set: { alertedStatus: kind, alertSentAt: now() } }
      );
      claimed = Number(claim?.modifiedCount) === 1;
      if (!claimed) {
        // Déjà alerté pour ce statut, ou aucun rapport stocké (cas « failed » : rien à marquer, on envoie quand même).
        const existing = kind === 'failed' ? await ReportModel.findOne(key).select('alertedStatus').lean() : true;
        if (existing) return { sent: false, reason: 'ALREADY_SENT' };
      }
    } catch (error) {
      // Base indisponible : pour un échec du rapprochement (souvent la cause même), on alerte sans dédoublonnage ;
      // pour un « mismatch », on s'abstient plutôt que de risquer des envois répétés.
      console.error('LEDGER ALERT CLAIM ERROR =>', { name: error?.name, code: error?.code });
      if (kind !== 'failed') return { sent: false, reason: 'ERROR' };
    }

    const { subject, text } = buildAlertEmail(input);
    const result = await mailer.sendMail({ to, subject, text });
    if (!result?.sent) {
      if (claimed) await release(ReportModel, key, kind);
      claimed = false;
      console.warn('LEDGER ALERT MAIL NOT SENT =>', { reason: safeToken(String(result?.reason || 'UNKNOWN').split(':')[0], 24) });
      return { sent: false, reason: 'MAIL_FAILED' };
    }
    return { sent: true };
  } catch (error) {
    console.error('LEDGER ALERT ERROR =>', { name: error?.name, code: error?.code });
    if (claimed && period) await release(ReportModel, { periodStart: period.from, periodEnd: period.to }, kind);
    return { sent: false, reason: 'ERROR' };
  }
};

// Retire la marque d'envoi pour qu'une relance puisse réessayer. Ne lève jamais.
const release = async (ReportModel, key, kind) => {
  try {
    await ReportModel.updateOne({ ...key, alertedStatus: kind }, { $unset: { alertedStatus: 1, alertSentAt: 1 } });
  } catch (error) {
    console.error('LEDGER ALERT RELEASE ERROR =>', { name: error?.name, code: error?.code });
  }
};

module.exports = { sendReconciliationAlert, buildAlertEmail, resolveRecipient, ALERT_STATUSES };
