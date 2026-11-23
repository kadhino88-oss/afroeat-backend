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

- **Admin 2FA is optional today (decision needed).** An admin login without 2FA still succeeds, but the response carries `twoFactorRequired: true` and `mustEnableTwoFactor: true` so the admin app can force enrolment. Decision to take: once every admin has enabled 2FA (`/api/admin/2fa/*`), make the login refuse admins without 2FA. Nothing is blocked yet, to avoid locking out all admins.
- Session tokens never carry a `purpose` claim; restricted tokens (2FA challenge, ...) are refused by `protect`.
- `GET /health` hides the database name/host. To let the e2e script verify the target database, set the same random `HEALTH_DETAILS_TOKEN` (16+ chars) on the server and in the script environment; the script sends it as `x-health-token`. (`.env.example` is not updated here: add the variable there.)
- Image URLs use `PUBLIC_API_URL` when set, otherwise the request `Host`.
- Rate limits count every request (not only failures) on `register` (per IP), `forgot-password` (per IP and per e-mail) and `login/2fa` (per challenge token, in addition to the per-IP limit). Counters are in memory per instance, like the other limiters.

## Payment routes and safety state

- `GET /api/payments/methods` returns the methods allowed by the server for the authenticated user.
- `POST /api/payments/select-cash` records an explicit cash selection. It has no production lock of its own: cash is blocked in real production only because order creation is locked (see below). Cash is collected by the restaurant (pickup / self-delivery) or by the courier (capped by `CASH_COURIER_MAX_TOTAL`, default 60, **not currency-aware**); the admin cash register aggregates orders and settlement is a bulk update with no declared amount, proof or audit trail.
- Card PaymentIntent and Checkout creation use the order amount, currency and owner stored in the database; the client only sends `orderId`. Payments are confirmed server-side by re-reading the Stripe object.
- `POST /api/payments/webhook` uses Stripe's raw signed payload. Handled events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `account.updated`. Each event is recorded by `event.id` (`StripeEvent`, TTL 30 days): a replayed event is acknowledged with 200 without re-running its effects, and a failed processing releases the record so Stripe can retry.

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
- TODO (needs design): a **lost dispute** only flags the order for manual review (`reconciliation_required`); Connect transfers are not reversed and `funds_withdrawn` / `funds_reinstated` balance movements are not reconciled.
- TODO: payouts left `pending` / `reconciliation_required` are not retried automatically (admin retry per order only).
- TODO: Connect account events need a separate Connect webhook endpoint with its own signing secret; only one `STRIPE_WEBHOOK_SECRET` is supported today.
- TODO: no tests yet for the transfer/reversal flow with Stripe mocked, and no staging evidence yet.
- Note: in-flight webhook duplicates are acknowledged immediately; a processing lock abandoned by a crash is retaken after 2 minutes.

P1:
- There is no dedicated ledger: accounting lives in `Order` fields. No Stripe fee / balance-transaction tracking, so net margin is unknown, and no automatic reconciliation against Stripe.
- Refund amounts are divided by 100 in `applyRefundResult`, which is wrong for zero-decimal currencies (XOF, XAF).
- Idempotency keys are weak for Checkout (changes every minute) and absent on `/refund`; the PaymentIntent key expires after 24 h.

Orders use menu-record prices and availability, restaurant currency/delivery fee/minimum-order rules, and a per-user idempotency key for safe client retries. The request fingerprint excludes client-supplied prices and labels. A reused key with different order details returns HTTP 409. Confirm the unique MongoDB index is present before relying on the concurrent-retry guarantee in a deployed database.

Donations are not offered until a beneficiary, accounting, settlement and public disclosure flow is configured. Partner identity documents are handled by the reviewed onboarding flow described in `docs/PASSAGE_EN_PRODUCTION.md`; do not accept identity files or bank details anywhere else.

## Production launch checklist

Before production enablement, configure a secret manager, production MongoDB with backups, HTTPS API domain, exact `CORS_ORIGINS`, Stripe production keys and signed webhooks (platform and Connect), the country/platform and approved marketplace split rates, Connect partner verification/payout accounts, a cash settlement ledger if cash is offered, push/map credentials and legal/privacy/support pages. Close the P0 gaps above, then run MongoDB integration tests, Stripe test-mode payments and webhook cases, Android/iOS device tests, cancellation/refund/dispute tests, accessibility checks and network-failure/retry tests.

## CI

GitHub Actions runs `npm ci`, `npm run check:syntax`, `npm test` and `npm ls --depth=0` for the backend branch and pull request workflows.
