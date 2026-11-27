const test = require('node:test');
const assert = require('node:assert/strict');

const callTerms = () => {
  const router = require('../routes/partnerApplicationRoutes');
  const layer = router.stack.find((l) => l.route && l.route.path === '/terms' && l.route.methods.get);
  let body;
  const res = { set() {}, json(payload) { body = payload; return this; } };
  layer.route.stack[layer.route.stack.length - 1].handle({}, res);
  return body;
};

test('conditions partenaires : payoutsAutomatic suit STRIPE_CONNECT_PAYOUTS_ENABLED (faux par défaut)', () => {
  const saved = { flag: process.env.STRIPE_CONNECT_PAYOUTS_ENABLED, key: process.env.STRIPE_SECRET_KEY };
  try {
    delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED;
    assert.equal(callTerms().terms.offer.payoutsAutomatic, false);
    process.env.STRIPE_CONNECT_PAYOUTS_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    assert.equal(callTerms().terms.offer.payoutsAutomatic, true);
    process.env.STRIPE_SECRET_KEY = '';
    assert.equal(callTerms().terms.offer.payoutsAutomatic, false);
  } finally {
    if (saved.flag === undefined) delete process.env.STRIPE_CONNECT_PAYOUTS_ENABLED; else process.env.STRIPE_CONNECT_PAYOUTS_ENABLED = saved.flag;
    if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved.key;
  }
});
