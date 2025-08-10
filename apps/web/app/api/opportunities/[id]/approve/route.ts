import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';
import { placeAndTrackOrder } from '@execution/index';
import { sizeWithRiskCaps } from '@risk/index';
import { insertAuditLog } from '@core/audit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const idKey = req.headers.get('Idempotency-Key');
  const client = supabase();

  if (idKey) {
    const { data: existing } = await client
      .from('idempotency_keys')
      .select('entity_id')
      .eq('key', idKey)
      .single();
    if (existing?.entity_id) {
      return NextResponse.json({ ok: true, tradeId: existing.entity_id });
    }
  }

  const body = await req.json().catch(() => ({}));
  const qty: number = body.qty ?? 1;
  if (qty <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid qty' }, { status: 400 });
  }

  const { data: opp, error: oppErr } = await client
    .from('trade_opportunities')
    .select('symbol, side, timeframe, entry_plan_json, stop_plan_json')
    .eq('id', params.id)
    .single();
  if (oppErr || !opp) {
    return NextResponse.json({ ok: false, error: 'opportunity not found' }, { status: 404 });
  }

  const entryPrice = Number(opp.entry_plan_json?.price ?? 0);
  const stopPrice = Number(opp.stop_plan_json?.stop ?? 0);
  const atrUSD = Math.abs(entryPrice - stopPrice);

  const baseEquity = Number(process.env.STARTING_EQUITY_USD ?? '100000');
  const [{ data: dayPnl }, { data: weekPnl }, { data: portfolioPnl }] =
    await Promise.all([
      client.rpc('day_pnl'),
      client.rpc('week_pnl'),
      client.rpc('portfolio_pnl'),
    ]);
  const dayRiskUSD = Math.abs(Number(dayPnl) || 0);
  const weekRiskUSD = Math.abs(Number(weekPnl) || 0);
  const equityUSD = baseEquity + (Number(portfolioPnl) || 0);

  const allowedQty = sizeWithRiskCaps(
    equityUSD,
    atrUSD,
    dayRiskUSD,
    weekRiskUSD,
  );
  if (qty > allowedQty) {
    return NextResponse.json(
      { ok: false, error: 'qty exceeds risk cap', cap: allowedQty },
      { status: 400 },
    );
  }

  const { data: trade, error: tradeErr } = await client
    .from('trades')
    .insert({
      opportunity_id: params.id,
      symbol: opp.symbol,
      side: opp.side,
      qty,
    })
    .select('id')
    .single();
  if (tradeErr) {
    return NextResponse.json({ ok: false, error: tradeErr.message }, { status: 500 });
  }

  await client
    .from('trade_opportunities')
    .update({ status: 'APPROVED' })
    .eq('id', params.id);

  await insertAuditLog(client, {
    actor_type: 'SYSTEM',
    action: 'APPROVE_OPPORTUNITY',
    entity_type: 'opportunity',
    entity_id: params.id,
    payload_json: {
      qty,
      allowedQty,
      equityUSD,
      atrUSD,
      dayRiskUSD,
      weekRiskUSD,
    },
  });

  try {
    await placeAndTrackOrder({
      tradeId: trade.id,
      symbol: opp.symbol,
      side: opp.side === 'LONG' ? 'buy' : 'sell',
      qty,
      type: 'market',
      supabase: client,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }

  await client
    .from('trade_opportunities')
    .update({ status: 'APPROVED' })
    .eq('id', params.id);

  if (idKey) {
    await client
      .from('idempotency_keys')
      .insert({ key: idKey, entity_type: 'trade', entity_id: trade.id })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, tradeId: trade.id });
}
