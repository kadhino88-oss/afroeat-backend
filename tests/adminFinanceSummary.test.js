'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAdminFinancePipeline } = require('../utils/adminFinanceSummary');

test('admin finance summary only aggregates explicitly captured payments', () => {
  const [match] = buildAdminFinancePipeline();
  assert.ok(match.$match.paymentStatus.$in.includes('Payé'));
  assert.ok(match.$match.paymentStatus.$in.includes('paid'));
  assert.equal(match.$match.paymentStatus.$in.includes('Non payé'), false);
  assert.equal(match.$match.paymentStatus.$in.includes('Remboursé'), false);
});

test('admin finance summary preserves currencies and stored marketplace splits', () => {
  const pipeline = buildAdminFinancePipeline();
  const group = pipeline.find((stage) => stage.$group)?.$group;
  const project = pipeline.find((stage) => stage.$project)?.$project;

  assert.deepEqual(group._id, { $toUpper: { $ifNull: ['$currency', 'EUR'] } });
  assert.match(JSON.stringify(group.platformCommission), /platformCommissionAmount/);
  assert.match(JSON.stringify(group.merchantShare), /restaurantEarning/);
  assert.match(JSON.stringify(group.courierShare), /driverEarning/);
  assert.match(JSON.stringify(group.ordersNeedingReconciliation), /marketplaceSplitCalculated/);
  assert.deepEqual(project.grossCollected, { $round: ['$grossCollected', 2] });
});
