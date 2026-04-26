# Faraj Software Solutions Client Portal

Vite client portal for `login.farajsoftwaresolutions.com`.

## What this includes

- Supabase-ready login and signup
- Faraj Software Solutions styled client portal
- Three software cards:
  - Pricing Assistant
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
