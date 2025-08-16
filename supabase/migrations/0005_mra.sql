create table if not exists mra_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text check (run_type in ('DAILY','MIDDAY','US_PREOPEN')) not null,
  status text check (status in ('QUEUED','RUNNING','DONE','FAILED')) default 'QUEUED',
  started_at timestamptz,
  finished_at timestamptz,
  metrics jsonb,
  error text
);

create table if not exists mra_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references mra_runs(id),
  symbol text not null,
  market_type text not null,
  liquidity numeric,
  volatility numeric,
  sentiment numeric,
  tech_confluence numeric,
  event_flags jsonb,
  raw jsonb
);

create table if not exists trading_opportunities (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references mra_runs(id),
  rank int not null,
  date date not null default (now()::date),
  symbol text not null,
  market_type text not null,
  bias text check (bias in ('long','short')) not null,
  entry_zone jsonb,
  target_zone jsonb,
  stop_loss numeric,
  confidence_score int,
  reasoning text,
  created_at timestamptz default now(),
  metadata jsonb
);

create table if not exists mra_audit_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references mra_runs(id),
  actor text,
  action text,
  payload_json jsonb,
  hash text,
  created_at timestamptz default now()
);
