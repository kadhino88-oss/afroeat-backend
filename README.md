# AFROEAT API

Private Node.js / Express / MongoDB API used by the Expo application in [afroeat-app](https://github.com/kadhino88-oss/afroeat-app).

## Local development

Requirements: Node.js 20+ and a running MongoDB instance.

```bash
cp .env.example .env
# Replace JWT_SECRET with a random secret of at least 32 characters.
npm ci
npm run check:syntax
npm test
npm start
```

The API listens on `http://localhost:5000` by default. `GET /health` reports runtime and MongoDB readiness. Set the mobile app's `EXPO_PUBLIC_API_URL` to an API base URL ending in `/api`; on a physical phone, use the computer's LAN IP, while an Android emulator can use `http://10.0.2.2:5000/api`.

The `.env.example` file is a template only. The backend rejects its placeholder JWT secret. Never commit `.env`, MongoDB credentials, JWT secrets, Stripe secret keys, webhook secrets or signing credentials.

## Security notes

- **Admin 2FA with a grace period.** Set `ADMIN_2FA_ENFORCE_AFTER` (ISO date, e.g. `2026-12-15T00:00:00Z`). Before that date nothing is blocked: an admin login without 2FA still succeeds and the response carries `twoFactorRequired`, `mustEnableTwoFactor` and `twoFactorDeadline` so the admin app can show a reminder. From that date, an admin without 2FA gets `403 ADMIN_2FA_REQUIRED` on every authenticated route except `/api/admin/2fa/status|setup|enable`, so they can still log in and enrol. Unset or invalid: nothing is enforced. Before the date, make sure every admin has enabled 2FA (`/api/admin/2fa/*`).
- Session tokens never carry a `purpose` claim; restricted tokens (2FA challenge, ...) are refused by `protect`.
- `GET /health` hides the database name/host. To let the e2e script verify the target database, set the same random `HEALTH_DETAILS_TOKEN` (16+ chars) on the server and in the script environment; the script sends it as `x-health-token`.
- Image URLs use `PUBLIC_API_URL` when set, otherwise the request `Host`.
- Rate limits count every request (not only failures) on `register` (per IP), `forgot-password` (per IP and per e-mail) and `login/2fa` (per challenge token, in addition to the per-IP limit). Counters are in memory per instance, like the other limiters.

## Payment routes and safety state

- `GET /api/payments/methods` returns the methods allowed by the server for the authenticated user.
- `POST /api/payments/select-cash` records an explicit cash selection. It has no production lock of its own: cash is blocked in real production only because order creation is locked (see below). Cash is collected by the restaurant (pickup / self-delivery) or by the courier (capped by `CASH_COURIER_MAX_TOTAL`, default 60, **not currency-aware**); the admin cash register aggregates orders and settlement is a bulk update with no declared amount, proof or audit trail.
- Card PaymentIntent and Checkout creation use the order amount, currency and owner stored in the database; the client only sends `orderId`. Payments are confirmed server-side by re-reading the Stripe object.
- `POST /api/payments/webhook` uses Stripe's raw signed payload. Handled events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `account.updated`. Each event is recorded by `event.id` (`StripeEvent`, TTL 30 days): a replayed event is acknowledged with 200 without re-running its effects, and a failed processing releases the record so Stripe can retry.

- `POST /api/payments/webhook/connect` receives events from connected accounts (`account.updated` updates the partner's Connect status; other events are acknowledged without effect). It needs its own Stripe "Connected accounts" webhook endpoint and signing secret, `STRIPE_CONNECT_WEBHOOK_SECRET`; without it the endpoint answers 400. It uses the raw signed payload (mounted before `express.json`) and the same `event.id` de-duplication as the platform webhook. `account.updated` is still also handled on `/api/payments/webhook` for backward compatibility.

### Scheduled payout retry

`POST /api/payments/connect/retry-payouts` retries delivered orders whose payout is `pending` or `reconciliation_required`, oldest attempt first, at most `limit` per call (query parameter, default 20, max 50, within a 25 s time budget). It skips orders with an open dispute or without a verified marketplace split, and reuses the same checks and Stripe idempotency keys as the per-order admin retry, so overlapping or repeated runs cannot create a second transfer. It does nothing while `STRIPE_CONNECT_PAYOUTS_ENABLED` is off. The response only contains counters: `{ success, retried, succeeded, failed }` (plus `skipped` when disabled).

It has no user session: it is authenticated with the shared secret `CRON_SECRET` sent as `Authorization: Bearer <CRON_SECRET>` (constant-time comparison). Without `CRON_SECRET` configured it answers 403; a missing or wrong secret answers 401. It sits behind the same `/api/payments` rate limiter as the other payment routes. The same secret also protects `POST /api/payments/ledger/reconcile-daily` (see "Payment ledger"). Use a long random value and call it from your scheduler (for instance every 15 minutes); the repository does not ship the schedule (`vercel.json` and the workflows are unchanged).

### Payment ledger

`LedgerEntry` (`models/LedgerEntry.js`) is an append-only journal of money movements, meant to reconcile the database with Stripe one day. Types: `charge`, `stripe_fee`, `refund`, `transfer`, `transfer_reversal`, `dispute_lost`, `cash_collected`, `cash_settled`. `amountMinor` is a signed integer in the currency's minor units (cents for EUR, whole units for XOF/XAF, via `utils/currency.js`): positive = value coming in to the platform, negative = value going out (the full table of signs is documented in the model). Each entry has a unique `idempotencyKey` (`charge:order:<orderId>`, `refund:<stripeRefundId>`, `transfer:<transferId>`, ...), so replaying the same event never duplicates it. Update and delete operations (document, query and `bulkWrite`) are refused by Mongoose hooks; a correction is a new entry of opposite sign.

**The ledger is fail-open.** `utils/ledger.js` never throws: a ledger outage, timeout or invalid entry is logged (error name/code only, no amounts or ids) and the payment, refund or payout continues unchanged. Writes are skipped immediately while MongoDB is not connected. It is wired into payment confirmation (`markOrderAsPaid`: webhook `payment_intent.succeeded` / `checkout.session.completed` and `/confirm`), refunds (`utils/orderRefund.js`, `/refund`, webhooks `refund.updated` and `charge.refunded`), Connect transfers and reversals (`utils/marketplacePayouts.js`), lost disputes (`charge.dispute.closed`), cash delivery and cash settlement. The Stripe fee is read best-effort from the charge's balance transaction right after a card payment (bounded wait); when unavailable nothing is recorded.

Indexes are required (the production database has `autoIndex` off): run `npm run db:sync-indexes`, in particular for the unique `idempotencyKey`.

Reconciliation is read-only and never corrects anything or moves money:

- `GET /api/admin/ledger/summary?from=&to=` (admin session, rate-limited on the route): ledger totals per type and per currency (`totals`) and the net per currency (`net`) over `[from, to)`. `from` and `to` are both required, UTC ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ssZ`, optional `.sss`), `from < to`, at most 366 days; anything else answers 400.
- `POST /api/payments/ledger/reconcile-daily`: for a cron, authenticated like the payout retry with `Authorization: Bearer <CRON_SECRET>` (403 without `CRON_SECRET` configured, 401 for a missing or wrong secret), rate-limited on the route. It reconciles the previous UTC day: ledger against orders (`utils/ledgerReconciliation.js`: paid order without `charge` entry, refund / transfer / reversal without entry, amount differences, duplicate entries for the same Stripe object) and ledger against Stripe (`stripe.balanceTransactions.list`, at most 50 pages of 100). It stores one `LedgerReconciliationReport` per day (status `ok` or `mismatch`, totals and at most 200 discrepancies; running it again the same day replaces that day's report) and answers with counters only: `{ success, status, discrepancies, ordersScanned, stripeTransactions, stripeComplete, truncated }`. Stripe unavailable or incomplete is reported as a `mismatch`. The repository does not ship the schedule.

To rebuild entries for past orders, use `node scripts/backfill-ledger.js`. It is a **dry run by default**; only `--apply` writes. It reuses the live keys, so it can be re-run or run after the live code has written, without duplicates. It rebuilds `charge`, `refund` (only when the order has a `stripeRefundId` and no refund entry yet), `transfer` and `transfer_reversal` entries from `Order` fields, approximating their dates, and never calls Stripe (no fees). Like `scripts/promote-admin.js` it refuses to run on another database than `EXPECT_DB` (default `afroeat_staging`).

### Production lock

Real production (`NODE_ENV=production`, not the staging sandbox) is **locked** by default: order creation and card payment creation are refused. The lock is lifted only when all of these are set (`utils/runtimeEnvironment.js`):

1. `AFROEAT_LIVE_COMMERCE=open`
2. a live Stripe secret key (`sk_live_` / `rk_live_`)
3. `STRIPE_WEBHOOK_SECRET`
4. `MARKETPLACE_RATES_JSON`

To close it again, remove `AFROEAT_LIVE_COMMERCE` and redeploy. Partner payouts are a separate switch: `STRIPE_CONNECT_PAYOUTS_ENABLED=true`. See `docs/PASSAGE_EN_PRODUCTION.md`.

**The lock only checks that these variables are present. It does not verify reconciliation, a ledger or staging evidence.** Do not open production until the known gaps below are closed and every box in `docs/STRIPE_CONNECT_PRODUCTION_READINESS.md` is checked with proof.

### Known gaps before production (from the payments review)

P0 (blocking):
- Fixed: `markOrderAsPaid` is atomic (conditional update), so webhook and `/confirm` announce an order only once; a payment received for an already cancelled order is refunded automatically (idempotent, `utils/orderRefund.js`) instead of reopening the order. If the refund cannot be issued, it is logged and `refundError` is set for manual reconciliation.
- Fixed: webhook de-duplication by `event.id`; Stripe-mocked tests now cover `handleWebhook` and `markOrderAsPaid` (`tests/payment*.test.js`, `tests/webhook*.test.js`).
- Partly handled events: `payment_intent.canceled`, `refund.updated` / `refund.failed` (failure recorded in `refundError`, never marked refunded) and `charge.dispute.updated` (flags the order). Still unhandled: async payment events and `transfer.*`.
- Fixed: a **lost dispute** (`charge.dispute.closed`, status `lost`) now reverses the Connect transfers already made (`stripe.transfers.createReversal`, stable idempotency key per transfer, only while `STRIPE_CONNECT_PAYOUTS_ENABLED` is active) or, when no transfer exists, cancels the payout without any Stripe call. If a reversal fails (e.g. insufficient balance) the order goes to `reconciliation_required` with the reason for admin handling, and a later retry can never create a new transfer for a lost-dispute order (`stripeDisputeLostAt`). Still TODO: `funds_withdrawn` / `funds_reinstated` balance movements are not reconciled, and the platform balance is not checked before a reversal.
- Fixed (needs scheduling): payouts left `pending` / `reconciliation_required` are retried in bounded batches by `POST /api/payments/connect/retry-payouts` (see "Scheduled payout retry" below). The platform does not schedule it: an operator must configure a cron that calls it; until then only the per-order admin retry runs.
- Fixed: Connect account events have a separate endpoint, `POST /api/payments/webhook/connect`, verified with `STRIPE_CONNECT_WEBHOOK_SECRET` (see below).
- Partly done: Stripe-mocked tests now cover transfers, lost-dispute reversals, batch retries and the Connect webhook. Still TODO: refund-driven reversal edge cases and any staging evidence with real Stripe test-mode accounts.
- Note: in-flight webhook duplicates are acknowledged immediately; a processing lock abandoned by a crash is retaken after 2 minutes.

P1:
- Partly done: a minimal append-only ledger now exists (see "Payment ledger" below), with a daily reconciliation report against Stripe. What remains: the ledger is **fail-open and best-effort**, not a source of truth you can close the books on. A write that fails is only logged, so a missing entry is detected by the reconciliation, not prevented. **Nobody reads the reports automatically**: a human must review `LedgerReconciliationReport` (status `mismatch`) every day, and nothing is ever corrected automatically. Stripe fees are recorded best-effort at payment time (no retry later, nothing for refunds / disputes / payout fees). Cash is only partly covered (`cash_collected` / `cash_settled` for the commission or remittance owed to the platform; the platform-to-restaurant `restaurant-payout` is not recorded). The Stripe balance-transaction mapping (`utils/ledgerReconciliation.js`) has only been exercised with in-memory doubles and must be validated against real Stripe test-mode data, including multi-currency settlement. Ledger immutability is enforced by Mongoose hooks only: also revoke update/delete rights on the `ledgerentries` collection for the application's database user.
- Fixed: minor-unit conversion lives in one module (`utils/currency.js`, `toMinorUnits` / `fromMinorUnits`) so refund amounts are correct for zero-decimal currencies (XOF, XAF). A partial refund seen by `applyRefundResult` is recorded but never marks the order fully refunded.
- Idempotency keys are weak for Checkout (changes every minute) and absent on `/refund`; the PaymentIntent key expires after 24 h.

Orders use menu-record prices and availability, restaurant currency/delivery fee/minimum-order rules, and a per-user idempotency key for safe client retries. The request fingerprint excludes client-supplied prices and labels. A reused key with different order details returns HTTP 409. Confirm the unique MongoDB index is present before relying on the concurrent-retry guarantee in a deployed database.

Donations are not offered until a beneficiary, accounting, settlement and public disclosure flow is configured. Partner identity documents are handled by the reviewed onboarding flow described in `docs/PASSAGE_EN_PRODUCTION.md`; do not accept identity files or bank details anywhere else.

## Production launch checklist

Before production enablement, configure a secret manager, production MongoDB with backups, HTTPS API domain, exact `CORS_ORIGINS`, Stripe production keys and signed webhooks (platform `STRIPE_WEBHOOK_SECRET` and Connect `STRIPE_CONNECT_WEBHOOK_SECRET`), `CRON_SECRET` and a scheduler for the payout retry and the daily ledger reconciliation (plus someone who reads its reports), the country/platform and approved marketplace split rates, Connect partner verification/payout accounts, a cash settlement ledger if cash is offered, push/map credentials and legal/privacy/support pages. Close the P0 gaps above, then run MongoDB integration tests, Stripe test-mode payments and webhook cases, Android/iOS device tests, cancellation/refund/dispute tests, accessibility checks and network-failure/retry tests.

## CI

GitHub Actions runs `npm ci`, `npm run check:syntax`, `npm test` and `npm ls --depth=0` for the backend branch and pull request workflows.
