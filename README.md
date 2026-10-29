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

## Payment routes and safety state

- `GET /api/payments/methods` returns the methods allowed by the server for the authenticated user.
- `POST /api/payments/select-cash` records an explicit cash selection in development. Production cash collection remains disabled until a collection/settlement ledger exists.
- Card PaymentIntent and Checkout creation require explicit Stripe test credentials in non-production. Production card payments remain blocked in this repository state until Connect onboarding, approved marketplace rates, payout corridors and reconciliation are implemented and reviewed.
- `POST /api/payments/webhook` uses Stripe's raw signed payload and should only be configured with a Stripe test webhook secret in development.

Orders now use menu-record prices and availability, restaurant currency/delivery fee/minimum-order rules, and a per-user idempotency key for safe client retries. The request fingerprint excludes client-supplied prices and labels. A reused key with different order details returns HTTP 409. Confirm the unique MongoDB index is present before relying on the concurrent-retry guarantee in a deployed database.

Production order creation is intentionally blocked until supported marketplace payment and payout paths are ready. Donations are not offered until a beneficiary, accounting, settlement and public disclosure flow is configured. Partner applications and identity/payout verification must be handled under the reviewed onboarding policy; do not accept identity files or bank details through this API unless that flow is explicitly implemented.

## Production launch checklist

Before production enablement, configure a secret manager, production MongoDB with backups, HTTPS API domain, exact `CORS_ORIGINS`, Stripe production keys and signed webhooks, the country/platform and approved marketplace split rates, Connect partner verification/payout accounts, a cash settlement ledger if cash is offered, push/map credentials and legal/privacy/support pages. Run MongoDB integration tests, Stripe test-mode payments and webhook cases, Android/iOS device tests, cancellation/refund/dispute tests, accessibility checks and network-failure/retry tests first.

## CI

GitHub Actions runs `npm ci`, `npm run check:syntax`, `npm test` and `npm ls --depth=0` for the backend branch and pull request workflows.
