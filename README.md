# Reimage Tech Client Portal

The active Shift Planner now includes NFC attendance and business workspaces. See [pilot deployment](docs/PILOT-SETUP.md) and the [root README](../README.md) for the current setup; legacy setup notes follow.

Vite client portal for `login.farajsoftwaresolutions.com`.

## What this includes

- Supabase-ready login and signup
- Reimage Tech styled client portal
- Software cards:
  - Pricing Assistant Pro
  - Shift Planner
  - Spa Cost Estimator
- Existing Pricing Assistant checkout links and managed Shift Planner pilot access
- Product access enforced by account or business membership
- Separate NFC/QR employee clock with revocable phone enrollment

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Then add your real Supabase values in `.env`:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_STRIPE_PRICING_ASSISTANT_PRO_LINK=https://buy.stripe.com/...
# Optional when the Pricing Assistant API is hosted somewhere else:
VITE_PRICING_ASSISTANT_MARKET_API=https://login.farajsoftwaresolutions.com/api/pricing-assistant/market/latest
VITE_PRICING_ASSISTANT_FRED_M2_API=https://login.farajsoftwaresolutions.com/api/pricing-assistant/fred-m2
```

## Build

```bash
npm run build
```

Upload the generated `dist` folder to the host/subdomain for:

```text
login.farajsoftwaresolutions.com
```

## Important next step

Pricing Assistant retains its existing checkout integration. Shift Planner is manually activated for pilot businesses. The payment flow for paid products is:

1. Customer signs in.
2. Customer clicks Stripe subscription link.
3. Stripe webhook fires after successful payment.
4. Backend updates Supabase `subscriptions` table.
5. Portal reads active subscriptions from Supabase.
6. Matching app becomes unlocked.

## Pricing Assistant Web App

Open the converted app through the protected portal route:

```text
/?app=pricing-assistant
```

Access is granted when the signed-in user has an active, paid, trialing, or admin-granted subscription row for:

- `pricing_assistant_pro`

Saved menus and saved cost configurations require the SQL in `faraj-admin-portal/sql/05_pricing_assistant_tables.sql`.

### Pricing Assistant M2 API

Pricing Assistant reads M2 from its own client-portal API. It does not depend on `market-signals.html` or the public website snapshot. It tries these sources in order:

1. `VITE_PRICING_ASSISTANT_MARKET_API`
2. `/api/pricing-assistant/market/latest`
3. `/api/market/latest`
4. `data/pricing-assistant/market/latest.json`
5. `VITE_PRICING_ASSISTANT_FRED_M2_API`
6. `/api/pricing-assistant/fred-m2`
7. `/api/fred?series_id=M2SL`

For local development, `vite.config.js` provides `/api/pricing-assistant/market/latest` directly when `FRED_API_KEY` is present in the root `.env.local` file:

```text
../.env.local
```

For GitHub Pages/static production, run the snapshot generator during GitHub Actions before `npm run build`:

```bash
npm run market:pricing-assistant
npm run build
```

Set `FRED_API_KEY` in GitHub Actions secrets. The generator writes:

```text
public/data/pricing-assistant/market/latest.json
```

Vite copies that file into `dist`, so the deployed browser can read M2 without a live API server and without exposing the API key.

For server-backed production, the client portal host can serve `/api/pricing-assistant/market/latest` instead. Set `FRED_API_KEY` as a server environment variable only; do not put it in the Vite client bundle.

## Standalone repository deployment

This repository owns the client portal and Supabase workforce migrations. Its shared branding assets are under `shared/`; it builds without the public or admin repositories. GitHub Actions deploys `main` to https://login.reimagebstech.com. Apply and verify the Supabase migrations and `time-clock` function before publishing the workforce client release.

Run `npm run test:database` for the disposable PostgreSQL integration suite. `npm run test:browser` additionally starts an isolated Vite server and runs browser workflows using fake local Supabase configuration. Tests never use `.env.local` production credentials. PostgreSQL defaults to `/opt/homebrew/opt/postgresql@14/bin`; override `POSTGRES_BIN` as needed. Browser tests use installed Google Chrome.
