-- Add AI metadata columns to trade_opportunities

alter table if exists trade_opportunities
  add column if not exists ai_source text,
  add column if not exists ai_request_id text,
  add column if not exists ai_latency_ms numeric,
  add column if not exists ai_echo_validated boolean;