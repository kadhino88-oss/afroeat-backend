'use strict';

// Ledger branché sur les chemins de paiement, remboursement et versement. Stripe, Order, User, Restaurant et
// LedgerEntry sont des doubles en mémoire : aucun réseau, aucune base. Chaque scénario vérifie aussi que
// la panne du ledger ne change RIEN au résultat du paiement / remboursement / versement.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes, createReq } = require('./helpers/paymentHarness');
const { installLedgerDouble } = require('./helpers/ledgerHarness');

const h = createPaymentHarness();
const double = installLedgerDouble();
const { controller, store, events, announced, stripe, calls, USER_ID, ORDER_ID, PI_ID } = h;
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const ledger = require('../utils/ledger');
const { createDeliveredOrderTransfers } = require('../utils/marketplacePayouts');

const transfers = [];
const reversals = [];
stripe.transfers = {
  create: async (params, options) => { transfers.push({ params, options }); return { id: `tr_${transfers.length}`, created: 1772000000 }; },
  createReversal: async (transferId, params, options) => {
    reversals.push({ transferId, params, options });
    return { id: `trr_${transferId}` };
  },
};
Restaurant.findById = (id) => ({ select: async () => ({ owner: `owner_${id}` }) });
User.findById = (id) => ({
  select: async () => ({
    _id: id, countryCode: 'FR', stripeConnectAccountId: `acct_${id}`,
    stripeConnectTransfersEnabled: true, stripeConnectPayoutsEnabled: true,
  }),
});

let refundListData = [];
let refundListError = null;
stripe.refunds.list = async () => {
  if (refundListError) throw refundListError;
  return { data: refundListData };
};

test.beforeEach((t) => {
  store.clear(); events.clear(); announced.length = 0; transfers.length = 0; reversals.length = 0;
  calls.refundsCreate.length = 0; refundListData = []; refundListError = null;
  double.reset();
  stripe.paymentIntents.retrieve = async () => ({});
  process.env.STRIPE_CONNECT_PAYOUTS_ENABLED = 'true';
  process.env.STRIPE_PLATFORM_COUNTRY = 'FR';
  process.env.STRIPE_CONNECT_COUNTRIES = 'FR';
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
});
test.after(() => { delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED; });

const send = async (event) => { const res = createRes(); await controller.handleWebhook(createReq(event), res); return res; };
const succeeded = (id, overrides = {}) => ({ id, type: 'payment_intent.succeeded', data: { object: h.paymentIntent(overrides) } });

// --- Paiement confirmé -----------------------------------------------------------------------

test('paiement confirmé : une écriture charge ; le même paiement rejoué (autre event.id, /confirm) ne la duplique pas', async () => {
  h.addOrder();
  assert.equal((await send(succeeded('evt_p1'))).statusCode, 200);
  assert.equal((await send(succeeded('evt_p2'))).statusCode, 200);
  await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: h.paymentIntent() });

  assert.equal(double.entries.length, 1);
  const [entry] = double.entries;
  assert.deepEqual(
    [entry.type, entry.amountMinor, entry.currency, entry.party, entry.stripeObjectId, entry.idempotencyKey],
    ['charge', 1000, 'EUR', 'customer', PI_ID, `charge:order:${ORDER_ID}`]
  );
  assert.equal(announced.length, 1);
});

test('paiement en XOF : montant en unités entières (aucune division par 100)', async () => {
  h.addOrder({ currency: 'XOF', totalPrice: 5000 });
  await send(succeeded('evt_x1', { amount: 5000, currency: 'xof' }));
  assert.equal(double.byType('charge')[0].amountMinor, 5000);
  assert.equal(double.byType('charge')[0].currency, 'XOF');
});

test('paiement Checkout : écriture charge avec le PaymentIntent de la session', async () => {
  h.addOrder({ stripePaymentIntentId: undefined, stripeCheckoutSessionId: 'cs_1' });
  const session = {
    id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_from_session', amount_total: 1000, currency: 'eur',
    metadata: { orderId: ORDER_ID, userId: USER_ID },
  };
  await send({ id: 'evt_cs1', type: 'checkout.session.completed', data: { object: session } });
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Payé');
  assert.equal(double.byType('charge')[0].stripeObjectId, 'pi_from_session');
});

test('frais Stripe : lus sur le balance_transaction (best-effort), une seule fois même si le paiement est rejoué', async () => {
  h.addOrder();
  let retrieves = 0;
  stripe.paymentIntents.retrieve = async (id, params) => {
    retrieves += 1;
    assert.deepEqual(params.expand, ['latest_charge.balance_transaction']);
    return { id, latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', fee: 35, net: 965, currency: 'eur' } } };
  };
  await send(succeeded('evt_f1'));
  await send(succeeded('evt_f2'));
  const [fee] = double.byType('stripe_fee');
  assert.deepEqual([fee.amountMinor, fee.currency, fee.party, fee.stripeObjectId], [-35, 'EUR', 'platform', 'txn_1']);
  assert.equal(double.byType('stripe_fee').length, 1);
  assert.equal(retrieves, 1);
});

test('frais Stripe : PaymentIntent déjà développé -> aucun appel Stripe supplémentaire', async () => {
  h.addOrder();
  let retrieves = 0;
  stripe.paymentIntents.retrieve = async () => { retrieves += 1; return {}; };
  const intent = h.paymentIntent({ latest_charge: { id: 'ch_2', balance_transaction: { id: 'txn_2', fee: 20, currency: 'eur' } } });
  await controller.markOrderAsPaid({ orderId: ORDER_ID, paymentIntent: intent });
  assert.equal(double.byType('stripe_fee')[0].amountMinor, -20);
  assert.equal(retrieves, 0);
});

test('frais Stripe indisponibles (erreur, réponse vide, frais nuls) : rien n\'est écrit et le paiement aboutit', async () => {
  for (const retrieve of [
    async () => { throw new Error('stripe down'); },
    async () => ({}),
    async () => ({ latest_charge: { balance_transaction: 'txn_unexpanded' } }),
    async () => ({ latest_charge: { balance_transaction: { id: 't', fee: 0, currency: 'eur' } } }),
  ]) {
    store.clear(); double.reset(); announced.length = 0;
    h.addOrder();
    stripe.paymentIntents.retrieve = retrieve;
    assert.equal((await send(succeeded(`evt_nf_${Math.random()}`))).statusCode, 200);
    assert.equal(store.get(ORDER_ID).paymentStatus, 'Payé');
    assert.equal(double.byType('stripe_fee').length, 0);
    assert.equal(double.byType('charge').length, 1);
    assert.equal(announced.length, 1);
  }
});

test('frais Stripe : un appel Stripe qui ne répond pas est abandonné après le délai', async () => {
  const o = { _id: ORDER_ID, stripePaymentIntentId: PI_ID, paidAt: new Date() };
  const hanging = { paymentIntents: { retrieve: () => new Promise(() => {}) } };
  const result = await ledger.recordStripeFee(o, { stripe: hanging, timeoutMs: 30 });
  assert.equal(result.status, 'skipped');
  assert.equal(double.entries.length, 0);
});

test('panne du ledger : le paiement est confirmé, annoncé une fois, la réponse webhook reste 200', async () => {
  const failures = [
    () => { double.state.failCreate = new Error('write failed'); },
    () => { double.state.failFind = new Error('read failed'); },
    () => { double.state.ready = false; },
  ];
  for (const breakLedger of failures) {
    store.clear(); events.clear(); announced.length = 0; double.reset();
    h.addOrder();
    breakLedger();
    const res = await send(succeeded(`evt_down_${Math.random()}`));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.received, true);
    assert.equal(store.get(ORDER_ID).paymentStatus, 'Payé');
    assert.equal(store.get(ORDER_ID).status, 'Confirmée');
    assert.equal(announced.length, 1);
    assert.equal(double.entries.length, 0);
  }
});

// --- Remboursements --------------------------------------------------------------------------

test('paiement tardif sur commande annulée : remboursement automatique + écritures charge et refund', async () => {
  h.addOrder({ status: 'Annulée', paymentStatus: 'Non payé' });
  await send(succeeded('evt_late1'));
  assert.equal(calls.refundsCreate.length, 1);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
  assert.equal(double.byType('charge')[0].amountMinor, 1000);
  assert.deepEqual([double.byType('refund')[0].amountMinor, double.byType('refund')[0].idempotencyKey], [-1000, 'refund:re_test_1']);
});

test('paiement tardif, ledger en panne : le remboursement est quand même émis et appliqué', async () => {
  double.state.failCreate = new Error('ledger down');
  h.addOrder({ status: 'Annulée', paymentStatus: 'Non payé' });
  const res = await send(succeeded('evt_late2'));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.refundsCreate.length, 1);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
  assert.equal(store.get(ORDER_ID).refundError, '');
  assert.equal(double.entries.length, 0);
});

test('refund.updated « succeeded » : une écriture refund, rejouée sous un autre event.id sans doublon ; XOF sans division', async () => {
  h.addOrder({ currency: 'XOF', totalPrice: 5000, paymentStatus: 'Payé', status: 'Annulée' });
  const refund = { id: 're_x1', status: 'succeeded', amount: 5000, currency: 'xof', payment_intent: PI_ID, created: 1772000000 };
  await send({ id: 'evt_ru1', type: 'refund.updated', data: { object: refund } });
  await send({ id: 'evt_ru2', type: 'refund.updated', data: { object: refund } });
  assert.equal(double.byType('refund').length, 1);
  assert.deepEqual([double.byType('refund')[0].amountMinor, double.byType('refund')[0].currency], [-5000, 'XOF']);
});

test('refund.updated « failed » ou « pending » : aucune écriture refund', async () => {
  h.addOrder({ paymentStatus: 'Payé', status: 'Annulée' });
  await send({ id: 'evt_ru3', type: 'refund.updated', data: { object: { id: 're_p', status: 'pending', amount: 1000, payment_intent: PI_ID } } });
  await send({ id: 'evt_ru4', type: 'refund.failed', data: { object: { id: 're_f', status: 'failed', amount: 1000, payment_intent: PI_ID } } });
  assert.equal(double.entries.length, 0);
});

test('refund.updated, ledger en panne : la commande est quand même marquée remboursée', async () => {
  double.state.failCreate = new Error('ledger down');
  h.addOrder({ paymentStatus: 'Payé', status: 'Annulée' });
  const res = await send({ id: 'evt_ru5', type: 'refund.updated', data: { object: { id: 're_z', status: 'succeeded', amount: 1000, payment_intent: PI_ID } } });
  assert.equal(res.statusCode, 200);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
});

const refundedCharge = (overrides = {}) => ({
  id: 'ch_1', payment_intent: PI_ID, amount: 1000, amount_refunded: 1000, currency: 'eur', refunded: true, ...overrides,
});

test('charge.refunded : un enregistrement par remboursement de l\'événement, sans doublon avec refund.updated', async () => {
  h.addOrder({ paymentStatus: 'Payé' });
  const refund = { id: 're_c1', status: 'succeeded', amount: 1000, currency: 'eur', payment_intent: PI_ID };
  await send({ id: 'evt_cr1', type: 'charge.refunded', data: { object: refundedCharge({ refunds: { data: [refund] } }) } });
  await send({ id: 'evt_cr2', type: 'refund.updated', data: { object: refund } });
  assert.equal(double.byType('refund').length, 1);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
});

test('charge.refunded sans liste dans l\'événement : lecture Stripe ; si elle échoue, aucune écriture et commande à jour', async () => {
  h.addOrder({ paymentStatus: 'Payé' });
  refundListData = [{ id: 're_l1', status: 'succeeded', amount: 400, currency: 'eur' }, { id: 're_l2', status: 'pending', amount: 600, currency: 'eur' }];
  await send({ id: 'evt_cr3', type: 'charge.refunded', data: { object: refundedCharge({ amount_refunded: 400, refunded: false }) } });
  assert.deepEqual(double.byType('refund').map((e) => e.amountMinor), [-400]);

  store.clear(); events.clear(); double.reset();
  h.addOrder({ paymentStatus: 'Payé' });
  refundListError = new Error('stripe down');
  const res = await send({ id: 'evt_cr4', type: 'charge.refunded', data: { object: refundedCharge() } });
  assert.equal(res.statusCode, 200);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
  assert.equal(double.byType('refund').length, 0);
});

test('remboursement admin (/refund) : écriture refund ; ledger en panne -> même réponse et même état', async () => {
  const run = async () => {
    store.clear(); double.entries.length = 0; calls.refundsCreate.length = 0;
    h.addOrder({ paymentStatus: 'Payé' });
    const res = createRes();
    await controller.refundPayment({ user: { role: 'admin' }, body: { orderId: ORDER_ID } }, res);
    return res;
  };
  const healthy = await run();
  assert.equal(healthy.statusCode, 200);
  assert.deepEqual(double.byType('refund').map((e) => e.amountMinor), [-1000]);

  double.state.failCreate = new Error('ledger down');
  const broken = await run();
  assert.equal(broken.statusCode, healthy.statusCode);
  assert.deepEqual(broken.body, healthy.body);
  assert.equal(store.get(ORDER_ID).paymentStatus, 'Remboursé');
  assert.equal(double.entries.length, 0);
});

// --- Transferts et réversions Connect --------------------------------------------------------

const delivered = (extra = {}) => {
  stripe.paymentIntents.retrieve = async (id) => h.paymentIntent({
    id, latest_charge: 'ch_1', amount: toMinor(extra.totalPrice ?? 10, extra.currency || 'EUR'), currency: String(extra.currency || 'EUR').toLowerCase(),
  });
  return deliveredOrder(extra);
};
const toMinor = (amount, currency) => (['XOF', 'XAF'].includes(currency) ? amount : Math.round(amount * 100));
const deliveredOrder = (extra = {}) => h.addOrder({
  status: 'Livrée', paymentStatus: 'Payé', paymentMethod: 'card', payoutStatus: 'pending', marketplaceSplitCalculated: true,
  restaurant: 'rest1', deliveryPerson: 'cour1', restaurantEarning: 7, driverEarning: 2, totalPrice: 10, currency: 'EUR', ...extra,
});

test('transferts Connect : une écriture négative par partenaire ; un second passage ne recrée ni transfert ni écriture', async () => {
  delivered();
  const result = await createDeliveredOrderTransfers(ORDER_ID);
  assert.equal(result.success, true);
  assert.deepEqual(
    double.byType('transfer').map((e) => [e.party, e.amountMinor, e.stripeObjectId, e.idempotencyKey]),
    [['restaurant', -700, 'tr_1', 'transfer:tr_1'], ['courier', -200, 'tr_2', 'transfer:tr_2']]
  );
  await createDeliveredOrderTransfers(ORDER_ID);
  assert.equal(transfers.length, 2);
  assert.equal(double.byType('transfer').length, 2);
});

test('transferts en XAF : unités entières', async () => {
  delivered({ currency: 'XAF', totalPrice: 5000, restaurantEarning: 3500, driverEarning: 800 });
  await createDeliveredOrderTransfers(ORDER_ID);
  assert.deepEqual(double.byType('transfer').map((e) => e.amountMinor), [-3500, -800]);
  assert.equal(transfers[0].params.amount, 3500);
});

test('versement, ledger en panne : transferts créés et commande « transferred », sans erreur', async () => {
  double.state.failCreate = new Error('ledger down');
  delivered();
  const result = await createDeliveredOrderTransfers(ORDER_ID);
  assert.equal(result.success, true);
  assert.equal(store.get(ORDER_ID).payoutStatus, 'transferred');
  assert.equal(store.get(ORDER_ID).stripeRestaurantTransferId, 'tr_1');
  assert.equal(store.get(ORDER_ID).stripeCourierTransferId, 'tr_2');
  assert.equal(double.entries.length, 0);
});

const lostDispute = (id, extra = {}) => ({
  id, type: 'charge.dispute.closed', data: { object: { id: 'dp_1', status: 'lost', amount: 1000, currency: 'eur', reason: 'fraudulent', payment_intent: PI_ID, ...extra } },
});
const withTransfers = (extra = {}) => delivered({
  payoutStatus: 'transferred', stripeDisputeId: 'dp_1', stripeRestaurantTransferId: 'tr_rest', stripeCourierTransferId: 'tr_cour', ...extra,
});

test('litige perdu : écriture dispute_lost négative + réversions positives par transfert, rejouables sans doublon', async () => {
  withTransfers();
  assert.equal((await send(lostDispute('evt_dl1'))).statusCode, 200);
  assert.deepEqual(double.byType('dispute_lost').map((e) => [e.amountMinor, e.idempotencyKey]), [[-1000, 'dispute_lost:dp_1']]);
  assert.deepEqual(
    double.byType('transfer_reversal').map((e) => [e.party, e.amountMinor, e.idempotencyKey]),
    [['restaurant', 700, 'transfer_reversal:trr_tr_rest'], ['courier', 200, 'transfer_reversal:trr_tr_cour']]
  );
  await send(lostDispute('evt_dl2'));
  assert.equal(double.byType('dispute_lost').length, 1);
  assert.equal(double.byType('transfer_reversal').length, 2);
});

test('litige perdu, ledger en panne : réversions Stripe et état de la commande inchangés', async () => {
  double.state.failCreate = new Error('ledger down');
  withTransfers();
  const res = await send(lostDispute('evt_dl3'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(reversals.map((r) => r.transferId), ['tr_rest', 'tr_cour']);
  assert.equal(store.get(ORDER_ID).payoutStatus, 'reversed');
  assert.equal(double.entries.length, 0);
});

test('remboursement intégral avec transferts : réversions enregistrées, réversion Stripe inchangée en cas de panne', async () => {
  withTransfers({ stripeDisputeId: null });
  await send({ id: 'evt_rv1', type: 'charge.refunded', data: { object: refundedCharge({ refunds: { data: [{ id: 're_rv', status: 'succeeded', amount: 1000, currency: 'eur' }] } }) } });
  assert.equal(double.byType('transfer_reversal').length, 2);
  assert.equal(double.byType('refund').length, 1);

  store.clear(); events.clear(); double.reset(); reversals.length = 0;
  double.state.failCreate = new Error('ledger down');
  withTransfers({ stripeDisputeId: null });
  const res = await send({ id: 'evt_rv2', type: 'charge.refunded', data: { object: refundedCharge() } });
  assert.equal(res.statusCode, 200);
  assert.equal(reversals.length, 2);
  assert.equal(store.get(ORDER_ID).payoutStatus, 'reversed');
});
