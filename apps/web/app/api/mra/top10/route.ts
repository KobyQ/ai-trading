import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';
import { getTop10 } from '@mra';

export async function GET(req: NextRequest) {
  const date = new URL(req.url).searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const client = supabaseServer();
  try {
    const opportunities = await getTop10(client, date);
    return NextResponse.json({ date, opportunities });
  } catch (e) {
    return NextResponse.json({ error: 'failed to fetch' }, { status: 500 });
  }
}
