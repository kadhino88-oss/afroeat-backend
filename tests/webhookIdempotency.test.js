'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentHarness, createRes, createReq } = require('./helpers/paymentHarness');
const { claimEvent, STALE_LOCK_MS } = require('../utils/stripeEventLog');

const h = createPaymentHarness();
const { controller, store, events, calls, announced, ORDER_ID } = h;

test.beforeEach(() => { store.clear(); events.clear(); announced.length = 0; calls.refundsCreate.length = 0; });

const succeeded = (id = 'evt_1') => ({ id, type: 'payment_intent.succeeded', data: { object: h.paymentIntent() } });

test('signature invalide : 400, aucun effet, aucun enregistrement', async () => {
  h.addOrder();
  const res = createRes();
  await controller.handleWebhook(createReq(succeeded(), 'bad'), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_WEBHOOK_SIGNATURE');
  assert.equal(events.size, 0);
  assert.equal(announced.length, 0);
});

test('même event.id rejoué deux fois (et en parallèle) : effets exécutés une seule fois', async () => {
  h.addOrder();
  const [a, b] = [createRes(), createRes()];
  await Promise.all([
    controller.handleWebhook(createReq(succeeded()), a),
    controller.handleWebhook(createReq(succeeded()), b),
  ]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const again = createRes();
  await controller.handleWebhook(createReq(succeeded()), again);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(announced.length, 1);
  assert.equal(events.get('evt_1').status, 'done');
});

test('échec de traitement : 500 et enregistrement libéré, le rejeu par Stripe est traité', async () => {
  h.addOrder();
  const original = h.Order.findById;
  h.Order.findById = async () => { throw new Error('db down'); };
  const failed = createRes();
  await controller.handleWebhook(createReq(succeeded()), failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(events.has('evt_1'), false);

  h.Order.findById = original;
  const retry = createRes();
  await controller.handleWebhook(createReq(succeeded()), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(announced.length, 1);
});

test('un verrou « processing » abandonné est repris après le délai, pas avant', async () => {
  const event = { id: 'evt_stale', type: 'x' };
  const t0 = Date.now();
  assert.equal(await claimEvent(h.StripeEvent, event, t0), 'claimed');
  assert.equal(await claimEvent(h.StripeEvent, event, t0 + 1000), 'duplicate');
  assert.equal(await claimEvent(h.StripeEvent, event, t0 + STALE_LOCK_MS + 1000), 'claimed');
});

test('le modèle StripeEvent : _id = event.id et purge TTL d\'environ 30 jours', () => {
  const schema = h.StripeEvent.schema;
  assert.equal(schema.path('_id').instance, 'String');
  assert.equal(schema.path('createdAt').options.expires, 60 * 60 * 24 * 30);
});
