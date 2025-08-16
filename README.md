# AI Trading (Daily/Hourly)

**AI-Driven Algorithmic Trading System** using:

- **Frontend**: Next.js (App Router) on **Vercel**
- **Backend**: **Supabase** (Postgres + Auth + RLS + Edge Functions + pg_cron)
- **AI**: Azure OpenAI (private tenant) for explainability (pros/cons, risk notes)
- **Scheduling**: pg_cron / Supabase Scheduler (with Vercel Cron as backup)

> Scope: Daily/Hourly strategies (no tick/HFT). Research runs T-60 before market open; per-minute monitoring for risk automation.

## Structure

```
/apps/web              # Next.js app (UI + server actions + API routes)
/packages/core         # shared types, schemas
/packages/strategy     # indicators, regime detection, signal logic
/packages/execution    # OMS, broker wrapper, idempotency helpers
/packages/risk         # risk rules, kill-switch, sizing helpers
/supabase/migrations   # SQL schema
/supabase/functions    # Edge Functions: research-run, monitor-open-trades
/.github/workflows     # CI templates
```

## Setup & Running

Follow these steps to get a local environment and Supabase project ready.

1. **Prerequisites**
   - Install Node.js 20+ and the [PNPM](https://pnpm.io/) package manager.
   - Install the [Supabase CLI](https://supabase.com/docs/guides/cli) to run migrations and deploy edge functions.

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Environment variables**
   - Copy `.env.example` to `.env` in the repo root and populate broker creds, Azure OpenAI keys and optional Telegram tokens.
   - In `apps/web/.env` set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - For edge functions (`supabase/functions/.env`) include `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and any broker API settings.

4. **Supabase project**
   - Create a Supabase project and run SQL migrations from `supabase/migrations`.
   - Apply row‑level security policies in `supabase/policies`.
   - Enable TOTP MFA by setting `auth.mfa.totp.enroll_enabled=true` and `verify_enabled=true` in `supabase/config.toml`.

5. **Deploy Edge Functions**
   ```bash
   supabase functions deploy research-run
   supabase functions deploy monitor-open-trades
   ```

6. **Schedule jobs**
   - Daily research: `30 13 * * 1-5` (60 min before U.S. market open).
   - Optional hourly research: `0 * * * *` calling `rpc_start_research('1h')`.
   - Update existing jobs with `cron.unschedule`/`cron.schedule` if needed.

7. **Run the Next.js app**
   ```bash
   cd apps/web
   pnpm dev
   ```

8. **Optional services**
   - Provide broker API keys or store them in Azure Key Vault referenced by `AZURE_KEY_VAULT_URL`.
   - Deploy `kill-switch` or `rotate-broker-keys` functions and configure Telegram notifications if desired.

## Notes
- Orders are **paper** by default (stubbed broker). Broker credentials are loaded from Azure Key Vault and rotated quarterly.
- All writes go to Postgres with idempotency and full audit logs.
- Trailing-stop tightening occurs on discrete milestones (+0.5R, +1R, …).
