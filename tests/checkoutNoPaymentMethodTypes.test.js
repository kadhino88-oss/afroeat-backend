'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'controllers', name), 'utf8');

// Stripe refuse `payment_method_types` pour stripe.checkout.sessions.create
// (« no longer supported when creating a Checkout Session »), mais l'accepte
// encore pour paymentIntents.create et setupIntents.create.
const checkoutCalls = (source) => {
  const out = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('stripe.checkout.sessions.create(', from);
    if (start === -1) return out;
    const end = source.indexOf('\n    );', start) === -1 ? start + 1500 : start + 1500;
    out.push(source.slice(start, end));
    from = start + 10;
  }
};

test('Checkout : aucune session ne reçoit payment_method_types', () => {
  for (const file of ['paymentController.js', 'savedCardController.js']) {
    const calls = checkoutCalls(read(file));
    assert.ok(calls.length >= 1, file);
    for (const call of calls) {
      // On ne regarde que le bloc d'options de la session (jusqu'à la fermeture de l'appel).
      const block = call.split(/\n\s*\}\s*,?\s*\n\s*\);/)[0];
      assert.doesNotMatch(block.replace(/\/\/[^\n]*/g, ''), /payment_method_types\s*:/, file);
    }
  }
});
