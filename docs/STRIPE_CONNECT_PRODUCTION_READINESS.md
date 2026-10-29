# Stripe Connect production-readiness checklist

## Current release gate

The production card-payment endpoint intentionally returns `503 MARKETPLACE_PAYMENTS_NOT_READY` while `NODE_ENV=production`. Do not remove this guard merely because unit tests or CI pass. The complete payment-to-settlement flow must be verified in a Stripe test environment against a staging deployment with MongoDB.

## Required configuration checks

- [ ] Stripe test secret key and webhook signing secret are configured in staging; no live credentials are used for test runs.
- [ ] The platform country and supported Connect countries are configured with `STRIPE_PLATFORM_COUNTRY`, `STRIPE_CONNECT_COUNTRIES`, and `STRIPE_CONNECT_CROSS_BORDER_COUNTRIES`.
- [ ] Marketplace commission and restaurant/courier allocation rules in `MARKETPLACE_RATES_JSON` are reviewed against approved business rules for every enabled currency.
- [ ] `STRIPE_CONNECT_PAYOUTS_ENABLED` stays disabled until the staging checklist is complete.
- [ ] The Stripe webhook endpoint verifies signatures and is configured for account updates, refunds, and dispute lifecycle events used by this backend.
- [ ] Connect onboarding completion, transfer eligibility, country restrictions, and dashboard links are verified for restaurant and courier accounts.

## End-to-end scenarios required in staging

### Checkout and order integrity
- [ ] Create a card order and verify the server-calculated amount, currency, order ID, owner, and Stripe metadata agree.
- [ ] Test card success, card failure, canceled orders, duplicate requests, retried requests, and duplicated/out-of-order webhooks.
- [ ] Verify a stale payment webhook cannot re-open a fully refunded or canceled order.
- [ ] Confirm cash orders never create Stripe transfers.

### Delivery and settlement
- [ ] Verify a transfer is eligible only for a paid card order with a verified marketplace split and a delivered state.
- [ ] Confirm restaurant and courier accounts must be enabled and country policy must allow each transfer.
- [ ] Retry the delivery transition and webhook; verify the per-order idempotency keys prevent duplicate transfers.
- [ ] Simulate a transient Stripe failure and verify the reconciliation queue can safely retry without double-paying.

### Refunds, disputes, and reconciliation
- [ ] Perform a full refund before and after transfer; verify the order state and any transfer reversal match Stripe's confirmed result.
- [ ] Perform a partial refund and verify the manual reconciliation path records the outstanding difference.
- [ ] Create and close a test dispute; verify the order is flagged and automatic payouts are blocked when appropriate.
- [ ] Verify reconciliation listing, retry, and manual resolution are restricted to administrators and record an auditable note.
- [ ] Reconcile AFROEAT's stored order split and transfer IDs against the Stripe test dashboard.

## CI and launch approval

- [ ] Backend CI passes syntax checks, all unit tests, and dependency-tree validation.
- [ ] Backend dependency audit passes.
- [ ] Mobile CI passes API configuration, wallet safety, localization, lint, web export, and Expo SDK dependency compatibility checks.
- [ ] All staging scenarios above have evidence (test IDs, sanitized logs, expected/actual amounts and webhook outcomes).
- [ ] Rollback steps are documented and tested; payout activation has an explicit owner and monitoring for failures and reconciliation backlog.

Only after all boxes are evidenced should a separate, reviewed change consider removing `MARKETPLACE_PAYMENTS_NOT_READY`. Keep real Connect payouts disabled during test execution.
