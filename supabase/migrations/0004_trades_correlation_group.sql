-- 0004_trades_correlation_group.sql
-- Add correlation_group column to trades
alter table trades add column if not exists correlation_group text;
