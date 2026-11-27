'use strict';

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const LedgerReconciliationReport = require('../models/LedgerReconciliationReport');
const { checkCronSecret } = require('../utils/cronAuth');
const { fromMinorUnits } = require('../utils/currency');
const { parsePeriod, getYesterdayPeriodUtc } = require('../utils/ledgerDates');
const { summarizeLedger } = require('../utils/ledger');
const { sendReconciliationAlert } = require('../utils/ledgerAlert');
const {
  reconcileLedgerWithOrders,
  fetchStripeBalanceTotals,
  compareLedgerWithStripe,
  MAX_DISCREPANCIES,
} = require('../utils/ledgerReconciliation');

// GET /api/admin/ledger/summary?from=&to= : totaux du ledger par type et par devise sur [from, to). Lecture seule.
const getLedgerSummary = async (req, res) => {
  const period = parsePeriod(req.query);
  if (!period.ok) {
    return res.status(400).json({ success: false, code: period.code, message: period.message });
  }
  try {
    const rows = await summarizeLedger({ from: period.from, to: period.to });
    const net = {};
    const totals = rows.map((row) => {
      net[row.currency] = (net[row.currency] || 0) + row.totalMinor;
      return { ...row, total: fromMinorUnits(row.totalMinor, row.currency) };
    });
    return res.status(200).json({
      success: true,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      totals,
      net: Object.entries(net).map(([currency, totalMinor]) => ({ currency, totalMinor, total: fromMinorUnits(totalMinor, currency) })),
    });
  } catch (error) {
    console.error('LEDGER SUMMARY ERROR =>', { name: error?.name, code: error?.code });
    return res.status(500).json({ success: false, message: 'Synthèse du ledger indisponible.' });
  }
};

// Alerte e-mail à échec ouvert : sendReconciliationAlert ne lève pas, ce filet protège la réponse du cron.
const alertSafely = async (input) => {
  try {
    await sendReconciliationAlert(input, { ReportModel: LedgerReconciliationReport });
  } catch (error) {
    console.error('LEDGER ALERT WRAPPER ERROR =>', { name: error?.name, code: error?.code });
  }
};

// POST /api/payments/ledger/reconcile-daily : rapproche la veille (UTC) avec les commandes et Stripe, stocke un
// rapport et ne renvoie que des compteurs. Authentifié par CRON_SECRET. Ne corrige JAMAIS rien.
const reconcileDailyCron = async (req, res) => {
  const auth = checkCronSecret(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ success: false, code: auth.code, message: 'Accès refusé.' });
  }
  if (!stripe) {
    return res.status(503).json({ success: false, code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe indisponible.' });
  }

  let period = null;
  try {
    period = getYesterdayPeriodUtc();
    const local = await reconcileLedgerWithOrders(period);
    const discrepancies = [...local.discrepancies];
    let truncated = local.truncated;

    let stripeSide = { totals: [], unmapped: [], transactions: 0, complete: false };
    try {
      stripeSide = await fetchStripeBalanceTotals({ stripe, ...period });
      if (!stripeSide.complete) discrepancies.push({ kind: 'stripe_fetch_incomplete' });
      for (const mismatch of compareLedgerWithStripe(local.ledgerTotals, stripeSide.totals)) discrepancies.push(mismatch);
    } catch (error) {
      console.error('LEDGER STRIPE FETCH ERROR =>', { type: error?.type, code: error?.code });
      discrepancies.push({ kind: 'stripe_unavailable' });
    }

    const discrepancyCount = Object.values(local.counts).reduce((sum, n) => sum + n, 0)
      + (discrepancies.length - local.discrepancies.length);
    if (discrepancies.length > MAX_DISCREPANCIES) truncated = true;

    const status = discrepancyCount > 0 ? 'mismatch' : 'ok';
    await LedgerReconciliationReport.findOneAndUpdate(
      { periodStart: period.from, periodEnd: period.to },
      {
        $set: {
          status,
          ledgerTotals: local.ledgerTotals,
          stripeTotals: stripeSide.totals,
          stripeUnmapped: stripeSide.unmapped,
          discrepancies: discrepancies.slice(0, MAX_DISCREPANCIES),
          discrepancyCount,
          truncated,
          stripeComplete: stripeSide.complete,
          stripeTransactions: stripeSide.transactions,
          ordersScanned: local.ordersScanned,
          ledgerEntriesScanned: local.ledgerEntriesScanned,
          generatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Alerte e-mail (échec ouvert : n'altère jamais la réponse). Uniquement pour « mismatch ».
    if (status === 'mismatch') {
      const countsByKind = { ...local.counts };
      for (const extra of discrepancies.slice(local.discrepancies.length)) {
        countsByKind[extra.kind] = (countsByKind[extra.kind] || 0) + 1;
      }
      await alertSafely({
        kind: 'mismatch', period, countsByKind, discrepancyCount, truncated,
        stripeComplete: stripeSide.complete, ledgerTotals: local.ledgerTotals, stripeTotals: stripeSide.totals,
      });
    }

    return res.status(200).json({
      success: true,
      status,
      discrepancies: discrepancyCount,
      ordersScanned: local.ordersScanned,
      stripeTransactions: stripeSide.transactions,
      stripeComplete: stripeSide.complete,
      truncated,
    });
  } catch (error) {
    console.error('LEDGER RECONCILE CRON ERROR =>', { name: error?.name, code: error?.code });
    if (period) await alertSafely({ kind: 'failed', period });
    return res.status(500).json({ success: false, message: 'Rapprochement du ledger impossible.' });
  }
};

module.exports = { getLedgerSummary, reconcileDailyCron };
