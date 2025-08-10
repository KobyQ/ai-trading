import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@lib/supabase';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const client = supabase();
  const { error } = await client
    .from('trade_opportunities')
    .update({ status: 'REJECTED' })
    .eq('id', params.id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, opportunityId: params.id });
}
