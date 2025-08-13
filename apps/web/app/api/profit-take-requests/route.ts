import { NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

export async function GET() {
  const client = supabase;
  const { data, error } = await client
    .from('profit_take_requests')
    .select('id, trade_id, price, created_at, expires_at')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, requests: data ?? [] });
}
