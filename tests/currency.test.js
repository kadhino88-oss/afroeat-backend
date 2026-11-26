'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes, createReq } = require('./helpers/paymentHarness');
const {
  CURRENCY_CONFIG, toMinorUnits, fromMinorUnits, getMinAmount, isSupportedCurrency,
} = require('../utils/currency');
const { applyRefundResult } = require('../utils/orderRefund');
const { toStripeAmount } = require('../utils/marketplacePayouts');

const h = createPaymentHarness();
const { controller, store, events, PI_ID } = h;
test.beforeEach(() => { store.clear(); events.clear(); });

test('single currency table: minor-unit factor and minimum per currency', () => {
  assert.deepEqual(Object.keys(CURRENCY_CONFIG).sort(), ['CAD', 'CHF', 'EUR', 'GBP', 'USD', 'XAF', 'XOF']);
  assert.equal(CURRENCY_CONFIG.EUR.multiplier, 100);
  assert.equal(CURRENCY_CONFIG.CHF.multiplier, 100);
  assert.equal(CURRENCY_CONFIG.XOF.multiplier, 1);
  assert.equal(CURRENCY_CONFIG.XAF.multiplier, 1);
  assert.equal(getMinAmount('xof'), 100);
  assert.equal(getMinAmount('EUR'), 0.5);
  assert.equal(getMinAmount('XYZ'), null);
  assert.equal(isSupportedCurrency(' chf '), true);
  assert.equal(isSupportedCurrency('JPY'), false);
});

test('toMinorUnits / fromMinorUnits round-trip for EUR, CHF, XOF and XAF', () => {
  for (const [currency, amount, minor] of [
    ['EUR', 12.34, 1234], ['CHF', 24.5, 2450], ['XOF', 5000, 5000], ['XAF', 12500, 12500],
  ]) {
    assert.equal(toMinorUnits(amount, currency), minor, `${currency} to minor`);
    assert.equal(fromMinorUnits(minor, currency), amount, `${currency} from minor`);
    assert.equal(fromMinorUnits(toMinorUnits(amount, currency), currency), amount);
  }
  // Pas d'erreur d'arrondi flottant sur les montants à 2 décimales.
  assert.equal(toMinorUnits(0.29, 'EUR'), 29);
  assert.equal(toMinorUnits(1.15, 'CHF'), 115);
});

test('currency helpers reject invalid input instead of guessing', () => {
  assert.equal(toMinorUnits(10, 'XYZ'), null);
  assert.equal(toMinorUnits('abc', 'EUR'), null);
  assert.equal(toMinorUnits(null, 'EUR'), null);
  assert.equal(toMinorUnits(Infinity, 'EUR'), null);
  assert.equal(fromMinorUnits(undefined, 'EUR'), null);
  assert.equal(fromMinorUnits(NaN, 'XOF'), null);
});

test('payout amounts stay strictly positive safe integers', () => {
  assert.equal(toStripeAmount(0, 'XOF'), null);
  assert.equal(toStripeAmount(-5, 'EUR'), null);
  assert.equal(toStripeAmount(Number.MAX_VALUE, 'EUR'), null);
  assert.equal(toStripeAmount(1500, 'XOF'), 1500);
  assert.equal(toStripeAmount(15, 'CHF'), 1500);
});

test('applyRefundResult: full refund converts minor units per currency', () => {
  for (const [currency, total, minor] of [
    ['EUR', 10, 1000], ['CHF', 24.5, 2450], ['XOF', 5000, 5000], ['XAF', 12500, 12500],
  ]) {
    const order = { currency, totalPrice: total };
    applyRefundResult(order, { id: 're_1', status: 'succeeded', amount: minor });
    assert.equal(order.paymentStatus, 'Remboursé', currency);
    assert.equal(order.stripeAmountRefunded, total, currency);
    assert.ok(order.refundedAt instanceof Date);
  }
});

test('applyRefundResult: a partial refund is recorded but never marks the order fully refunded', () => {
  for (const [currency, total, minor, expected] of [
    ['EUR', 10, 400, 4], ['CHF', 24.5, 1000, 10], ['XOF', 5000, 2000, 2000], ['XAF', 12500, 500, 500],
  ]) {
    const order = { currency, totalPrice: total, paymentStatus: 'Payé' };
    applyRefundResult(order, { id: 're_p', status: 'succeeded', amount: minor });
    assert.equal(order.paymentStatus, 'Payé', currency);
    assert.equal(order.refundedAt, undefined, currency);
    assert.equal(order.stripeAmountRefunded, expected, currency);
    assert.match(order.lastPaymentError, /partiel/);
  }
});

test('applyRefundResult: pending refunds change nothing but the refund id', () => {
  const order = { currency: 'XOF', totalPrice: 5000, paymentStatus: 'Payé' };
  applyRefundResult(order, { id: 're_x', status: 'pending', amount: 5000 });
  assert.equal(order.paymentStatus, 'Payé');
  assert.equal(order.stripeRefundId, 're_x');
  assert.equal(order.stripeAmountRefunded, undefined);
});

const sendWebhook = async (event) => {
  const res = createRes();
  await controller.handleWebhook(createReq(event), res);
  return res;
};

test('charge.refunded webhook: partial and full refunds in zero-decimal and decimal currencies', async () => {
  let n = 0;
  for (const [currency, total, partialMinor, fullMinor] of [
    ['EUR', 10, 400, 1000], ['CHF', 24.5, 1000, 2450], ['XOF', 5000, 2000, 5000], ['XAF', 12500, 500, 12500],
  ]) {
    for (const [label, refundedMinor] of [['partial', partialMinor], ['full', fullMinor]]) {
      store.clear();
      h.addOrder({ currency, totalPrice: total, paymentStatus: 'Payé' });
      n += 1;
      const res = await sendWebhook({
        id: `evt_cur_${n}`, type: 'charge.refunded',
        data: { object: { id: 'ch_1', payment_intent: PI_ID, currency: currency.toLowerCase(), amount: fullMinor, amount_refunded: refundedMinor, refunded: label === 'full' } },
      });
      assert.equal(res.statusCode, 200);
      const saved = store.get(h.ORDER_ID);
      const expectedAmount = label === 'full' ? total : fromMinorUnits(partialMinor, currency);
      assert.equal(saved.stripeAmountRefunded, expectedAmount, `${currency} ${label}`);
      assert.equal(saved.paymentStatus, label === 'full' ? 'Remboursé' : 'Payé', `${currency} ${label}`);
    }
  }
});
