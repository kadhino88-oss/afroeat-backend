'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'x'.repeat(48);

const { router } = require('../routes/paymentRoutes');

const find = (path, method) =>
  router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);

for (const path of ['/connect/retry-payouts', '/ledger/reconcile-daily']) {
  for (const method of ['post', 'get']) {
    test(`${method.toUpperCase()} ${path} : limiteur de débit puis gestionnaire cron, sans session`, () => {
      const layer = find(path, method);
      assert.ok(layer, 'route absente');
      assert.equal(layer.route.stack.length, 2);
      const names = layer.route.stack.map((l) => l.handle.name);
      assert.ok(!names.includes('protect'), 'la route cron ne doit pas exiger de session utilisateur');
    });
  }
}
