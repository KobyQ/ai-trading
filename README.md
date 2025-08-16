# AI Trading

**AI-Driven Algorithmic Trading System** using:

* **Frontend**: Next.js (App Router) on **Vercel**
* **Backend**: **Supabase** (Postgres + Auth + RLS + Edge Functions + pg\_cron)
* **AI**: Azure OpenAI (private tenant) for explainability (pros/cons, risk notes)
* **Scheduling**: pg\_cron / Supabase Scheduler (with Vercel Cron as backup)

> Scope: Daily/Hourly strategies (no tick/HFT). Research runs T-60 before market open; per-minute monitoring for risk automation.

---

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

---

## Setup & Running

Follow these steps to get a local environment and Supabase project ready.

### 1. Prerequisites

* Node.js 20+ and [PNPM](https://pnpm.io/)
* [Supabase CLI](https://supabase.com/docs/guides/cli)

```bash
# Node & pnpm
node -v
corepack enable && corepack prepare pnpm@latest --activate

# Supabase CLI (macOS)
brew install supabase/tap/supabase
# or
npm i -g supabase
```

---

### 2. Install dependencies

```bash
pnpm install
```

---

### 3. Environment variables

* Copy `.env.example` → `.env` (repo root).
* Copy `apps/web/.env.example` → `apps/web/.env`.

**apps/web/.env** (public keys):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

**.env** (server only):

```
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_KEY_VAULT_URL=
BROKER=alpaca
BROKER_KEY=
BROKER_SECRET=
BROKER_PAPER=true
BROKER_BASE_URL=
```

---

### 4. Supabase project

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Verify:

```sql
select table_name from information_schema.tables
where table_schema='public' and table_type='BASE TABLE';
```

Enable MFA (optional):

```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

---

### 5. Deploy Edge Functions

```bash
supabase functions deploy research-run
supabase functions deploy monitor-open-trades
```

Set secrets:

```bash
supabase secrets set \
  AZURE_OPENAI_ENDPOINT="$AZURE_OPENAI_ENDPOINT" \
  AZURE_OPENAI_API_KEY="$AZURE_OPENAI_API_KEY" \
  AZURE_OPENAI_DEPLOYMENT="$AZURE_OPENAI_DEPLOYMENT" \
  BROKER="$BROKER" \
  BROKER_KEY="$BROKER_KEY" \
  BROKER_SECRET="$BROKER_SECRET" \
  BROKER_PAPER="$BROKER_PAPER" \
  BROKER_BASE_URL="$BROKER_BASE_URL"
```

---

### 6. Schedule jobs

* **Daily research** (1h before U.S. market open):
  Cron: `30 13 * * 1-5` (DST months), add `30 14 * * 1-5` for non-DST months.
* **Monitor per-minute:** `* * * * *`

Option A — Supabase Dashboard Scheduler.
Option B — pg\_cron in DB:

```sql
create extension if not exists pg_cron;
select cron.schedule('mra_daily_dst','30 13 * * 1-5',$$select rpc_start_research('1d')$$);
select cron.schedule('monitor_per_min','* * * * *',$$select rpc_monitor_open_trades()$$);
```

---

### 7. Seed config (optional)

```sql
insert into risk_limits (scope, cap_type, value, active) values
('TRADE','PCT',1,true),
('DAY','PCT',2,true),
('WEEK','PCT',5,true)
on conflict do nothing;
```

---

### 8. Run the Next.js app

```bash
cd apps/web
pnpm dev
# http://localhost:3000
```

---

### 9. Smoke tests

```bash
# research run
supabase functions invoke research-run --no-verify-jwt --data '{"timeframe":"1d"}'

# monitor run
supabase functions invoke monitor-open-trades --no-verify-jwt --data '{}'
```

API test:

```bash
curl -X POST http://localhost:3000/api/opportunities/<uuid>/approve \
  -H "Content-Type: application/json"
```

UI test: visit `/opportunities`, approve one, and confirm audit log/trade row.

---

### 10. Deploy web to Vercel

```bash
npm i -g vercel
vercel link
vercel
```

Add **Environment Variables** in Vercel → Settings:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_DEPLOYMENT
AZURE_KEY_VAULT_URL
```

Add Vercel Cron (backup):

* 08:00 GMT daily → `GET /api/mra/run?type=DAILY`
* 12:00 GMT daily → `GET /api/mra/run?type=MIDDAY`

---

## Notes

* Orders are **paper** by default (stubbed broker).
* Broker creds can live in **Azure Key Vault**.
* All writes are idempotent and audited.
* Trailing-stops tighten on milestones (+0.5R, +1R, …).
* “Done” means: db migrations applied, functions deployed, `/opportunities` showing rows, approvals writing trades + audit logs, and schedules running daily/hourly.

