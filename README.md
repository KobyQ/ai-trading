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

## Quick Start

1. **Install** (node 20+, pnpm recommended)
   ```bash
   pnpm install
   ```

2. **Create .env files**  
   - Copy `.env.example` to `.env` in `apps/web` and root and fill values.

3. **Run Next.js**
   ```bash
   cd apps/web
   pnpm dev
   ```

4. **Supabase**
   - Create a Supabase project, run SQL from `supabase/migrations/0001_init.sql`
   - Apply RLS policies from `supabase/policies`
   - Enable TOTP-based MFA via `supabase/config.toml`
   - Deploy functions:
     ```bash
     supabase functions deploy research-run
     supabase functions deploy monitor-open-trades
     ```

5. **Cron**
   - Daily research: `30 13 * * 1-5` (60 min before U.S. market open)
   - Optional hourly research: `0 * * * *` calls `rpc_start_research('1h')`
   - If jobs already exist, re-run the migration or unschedule/reschedule manually:
     ```sql
     select cron.unschedule('daily_research');
     select cron.schedule('daily_research', '30 13 * * 1-5', $$ select rpc_start_research('1d'); $$);
     select cron.schedule('hourly_research', '0 * * * *', $$ select rpc_start_research('1h'); $$); -- optional
     ```

## Notes
- Orders are **paper** by default (stubbed broker). Broker credentials are loaded from Azure Key Vault and rotated quarterly.
- All writes go to Postgres with idempotency and full audit logs.
- Trailing-stop tightening occurs on discrete milestones (+0.5R, +1R, …).
