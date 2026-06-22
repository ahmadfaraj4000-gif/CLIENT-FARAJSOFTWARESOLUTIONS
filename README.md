# Faraj Software Solutions Client Portal

Vite client portal for `login.farajsoftwaresolutions.com`.

## What this includes

- Supabase-ready login and signup
- Faraj Software Solutions styled client portal
- Software cards:
  - Pricing Assistant Pro
  - Shift Planner
  - Spa Cost Estimator
- Placeholder Stripe subscription links
- Locked app buttons until subscription access is connected
- Temporary dev unlock buttons for front-end testing only

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

The current Stripe links are placeholders. The real production flow should be:

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
