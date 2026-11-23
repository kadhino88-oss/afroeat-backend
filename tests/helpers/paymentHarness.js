'use strict';

// Banc d'essai du contrôleur de paiement : Stripe et le modèle Order sont remplacés par des
// doubles en mémoire (aucun réseau, aucune base). Les mises à jour conditionnelles du faux Order
// sont atomiques (JavaScript mono-thread) comme le sont celles de MongoDB.

const ORDER_ID = '64b0000000000000000000a1';
const USER_ID = '64b0000000000000000000b1';
const PI_ID = 'pi_test_123';

const matches = (doc, filter) => Object.entries(filter).every(([key, cond]) => {
  const value = doc[key];
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    if ('$nin' in cond) return !cond.$nin.includes(value);
    if ('$in' in cond) return cond.$in.includes(value);
    if ('$ne' in cond) return value !== cond.$ne;
    return false;
  }
  return String(value) === String(cond);
});

const createPaymentHarness = () => {
  process.env.JWT_SECRET = 'x'.repeat(48);
  process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_harness';

  const calls = { refundsCreate: [], constructEvent: 0 };
  const stripe = {
    webhooks: {
      constructEvent: (body, signature) => {
        calls.constructEvent += 1;
        if (signature !== 'valid') throw new Error('No signatures found matching the expected signature');
        return typeof body === 'string' || Buffer.isBuffer(body) ? JSON.parse(String(body)) : body;
      },
    },
    refunds: {
      create: async (params, options) => {
        calls.refundsCreate.push({ params, options });
        return { id: 're_test_1', status: 'succeeded', amount: 1000 };
      },
      list: async () => ({ data: [] }),
    },
    checkout: { sessions: { retrieve: async () => ({}) } },
    paymentIntents: { retrieve: async () => ({}) },
    customers: { create: async () => ({ id: 'cus_1' }) },
  };
  const stripePath = require.resolve('stripe');
  require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: () => stripe };

  const Order = require('../../models/Order');
  const store = new Map();
  const wrap = (data) => {
    const doc = { ...data };
    Object.defineProperty(doc, 'save', {
      enumerable: false,
      value: async () => { store.set(String(doc._id), { ...doc }); return doc; },
    });
    Object.defineProperty(doc, 'toObject', { enumerable: false, value: () => ({ ...doc }) });
    return doc;
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  Order.findById = async (id) => { await tick(); const d = store.get(String(id)); return d ? wrap(d) : null; };
  Order.findOne = async (filter) => { await tick(); const d = [...store.values()].find((x) => matches(x, filter)); return d ? wrap(d) : null; };
  Order.findOneAndUpdate = async (filter, update) => {
    await tick();
    const d = [...store.values()].find((x) => matches(x, filter));
    if (!d) return null;
    // Section critique : lecture-modification-écriture sans point d'attente.
    if (update.$set) Object.assign(d, update.$set);
    if (update.$push) for (const [k, v] of Object.entries(update.$push)) d[k] = [...(d[k] || []), v];
    if (!update.$set && !update.$push) Object.assign(d, update);
    return wrap(d);
  };

  const dispatch = require('../../utils/courierDispatch');
  const announced = [];
  dispatch.announcePaidOrder = async (order) => { announced.push(String(order._id)); };

  const addOrder = (overrides = {}) => {
    const doc = {
      _id: ORDER_ID, user: USER_ID, status: 'En attente', paymentStatus: 'Non payé', paymentMethod: 'card',
      totalPrice: 10, currency: 'EUR', stripePaymentIntentId: PI_ID, statusHistory: [{ status: 'En attente' }],
      ...overrides,
    };
    store.set(String(doc._id), doc);
    return doc;
  };

  const paymentIntent = (overrides = {}) => ({
    id: PI_ID, status: 'succeeded', amount: 1000, currency: 'eur',
    metadata: { orderId: ORDER_ID, userId: USER_ID }, ...overrides,
  });

  const controller = require('../../controllers/paymentController');
  return { controller, Order, store, stripe, calls, announced, addOrder, paymentIntent, ORDER_ID, USER_ID, PI_ID, wrap, matches };
};

const createRes = () => ({
  statusCode: 200, body: null,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

module.exports = { createPaymentHarness, createRes, ORDER_ID, USER_ID, PI_ID };
