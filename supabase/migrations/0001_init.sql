-- 0001_init.sql
-- Set up core tables and schedule comments for pg_cron examples at bottom

create table if not exists calendars (
  symbol text,
  venue text,
  session_open time,
  session_close time,
  holiday date,
  half_day boolean default false,
  tz text
);

create table if not exists market_data_pti (
  symbol text not null,
  timeframe text not null,
  ts timestamptz not null,
  o numeric, h numeric, l numeric, c numeric, v numeric,
  revision int default 0,
  hash text,
  primary key(symbol, timeframe, ts, revision)
);

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  params_json jsonb,
  trained_until date,
  regime_signature text,
  sha_hash text,
  created_at timestamptz default now()
);

create table if not exists trade_opportunities (
  id uuid primary key default gen_random_uuid(),
  report_id uuid,
  strategy_id uuid,
  model_id uuid,
  model_version text,
  symbol text not null,
  side text check (side in ('LONG','SHORT')) not null,
  timeframe text not null,
  entry_plan_json jsonb,
  stop_plan_json jsonb,
  take_profit_json jsonb,
  risk_summary text,
  expected_return numeric,
  confidence numeric,
  ai_summary text,
  ai_risks text,
  status text check (status in ('PENDING_APPROVAL','APPROVED','REJECTED','EXPIRED')) default 'PENDING_APPROVAL',
  created_at timestamptz default now()
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid references trade_opportunities(id),
  symbol text not null,
  side text check (side in ('LONG','SHORT')) not null,
  qty numeric not null,
  entry_price numeric,
  stop_type text,
  stop_params_json jsonb,
  status text check (status in ('OPEN','CLOSING','CLOSED')) default 'OPEN',
  opened_at timestamptz default now(),
  closed_at timestamptz,
  close_reason text
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references trades(id),
  broker text,
  client_order_id text unique,
  type text,
  side text,
  qty numeric,
  price numeric,
  status text,
  raw_request jsonb,
  raw_response jsonb,
  created_at timestamptz default now()
);

create table if not exists executions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  price numeric,
  qty numeric,
  fee numeric,
  ts timestamptz default now(),
  raw_fill jsonb
);

create table if not exists risk_limits (
  id uuid primary key default gen_random_uuid(),
  scope text,      -- TRADE | DAY | WEEK | PORTFOLIO | SECTOR
  cap_type text,   -- PCT | USD | VOL
  value numeric,
  active boolean default true
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text, -- SYSTEM | USER
  actor_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  payload_json jsonb,
  hash text,
  created_at timestamptz default now()
);

create table if not exists idempotency_keys (
  key text primary key,
  entity_type text,
  entity_id uuid,
  created_at timestamptz default now()
);

-- Example pg_cron comments (configure via dashboard)
-- SELECT cron.schedule('daily_research', '0 13 * * 1-5', $$ select rpc_start_research('1d'); $$);
-- SELECT cron.schedule('monitor_trades', '* * * * *', $$ select rpc_monitor_open_trades(); $$);
