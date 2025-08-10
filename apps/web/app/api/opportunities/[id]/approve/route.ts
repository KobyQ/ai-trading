import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';
import { placeAndTrackOrder } from '@execution/index';

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
    .select('symbol, side, timeframe')
    .eq('id', params.id)
    .single();
  if (oppErr || !opp) {
    return NextResponse.json({ ok: false, error: 'opportunity not found' }, { status: 404 });
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
