'use strict';

const isFullyRefundedCharge = (charge) => {
  if (!charge || typeof charge !== 'object') return false;
  if (charge.refunded === true) return true;

  const amount = Number(charge.amount);
  const amountRefunded = Number(charge.amount_refunded);
  return Number.isFinite(amount) &&
    Number.isFinite(amountRefunded) &&
    amount > 0 &&
    amountRefunded >= amount;
};

module.exports = { isFullyRefundedCharge };
