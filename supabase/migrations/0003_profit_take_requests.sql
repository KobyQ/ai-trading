-- 0003_profit_take_requests.sql
-- Table for pending profit-take approvals

create table if not exists profit_take_requests (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references trades(id),
  price numeric,
  status text check (status in ('PENDING','APPROVED','DENIED','EXPIRED')) default 'PENDING',
  created_at timestamptz default now(),
  expires_at timestamptz,
  decision_at timestamptz
);
