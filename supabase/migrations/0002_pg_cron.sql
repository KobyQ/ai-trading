-- 0002_pg_cron.sql
-- Schedule pg_cron jobs for market hours expressed in GMT (UTC)

-- Ensure pg_cron extension is available
create extension if not exists pg_cron;

-- Run daily research roughly 90 minutes before the U.S. market opens
select cron.schedule(
  'daily_research',
  '0 13 * * 1-5',
  $$ select rpc_start_research('1d'); $$
);

-- Monitor open trades during the regular session (14:30-21:00 GMT)
-- 14:30-14:59 every minute
select cron.schedule(
  'monitor_trades_open',
  '30-59 14 * * 1-5',
  $$ select rpc_monitor_open_trades(); $$
);
-- 15:00-20:59 every minute
select cron.schedule(
  'monitor_trades_session',
  '0-59 15-20 * * 1-5',
  $$ select rpc_monitor_open_trades(); $$
);
-- Run once at the close 21:00
select cron.schedule(
  'monitor_trades_close',
  '0 21 * * 1-5',
  $$ select rpc_monitor_open_trades(); $$
);
