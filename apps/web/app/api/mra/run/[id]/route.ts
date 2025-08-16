import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const client = supabaseServer();
  const { data: run, error } = await client
    .from('mra_runs')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !run) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const { count: candidatesCount } = await client
    .from('mra_candidates')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', params.id);
  const { count: publishedCount } = await client
    .from('trading_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', params.id);
  return NextResponse.json({
    run,
    candidates_count: candidatesCount || 0,
    published_count: publishedCount || 0,
    metrics: run.metrics || {},
  });
}
