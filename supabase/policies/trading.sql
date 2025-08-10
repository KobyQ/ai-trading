-- Enable row level security on core trading tables
alter table if exists trade_opportunities enable row level security;
alter table if exists trades enable row level security;
alter table if exists orders enable row level security;

-- Admins can do anything
create policy "admin_full_access" on trade_opportunities
  for all using ((auth.jwt() ->> 'role') = 'admin');
create policy "admin_full_access" on trades
  for all using ((auth.jwt() ->> 'role') = 'admin');
create policy "admin_full_access" on orders
  for all using ((auth.jwt() ->> 'role') = 'admin');

-- Traders can manage trading data
create policy "trader_access" on trade_opportunities
  for all using ((auth.jwt() ->> 'role') = 'trader');
create policy "trader_access" on trades
  for all using ((auth.jwt() ->> 'role') = 'trader');
create policy "trader_access" on orders
  for all using ((auth.jwt() ->> 'role') = 'trader');

-- Viewers have read-only access
create policy "viewer_read" on trade_opportunities
  for select using ((auth.jwt() ->> 'role') in ('viewer','trader','admin'));
create policy "viewer_read" on trades
  for select using ((auth.jwt() ->> 'role') in ('viewer','trader','admin'));
create policy "viewer_read" on orders
  for select using ((auth.jwt() ->> 'role') in ('viewer','trader','admin'));
