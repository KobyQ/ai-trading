import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@lib/supabase-server';
import { runMRA, RunType } from '@mra';

export async function GET(req: NextRequest) {
  const type = (new URL(req.url).searchParams.get('type') || 'DAILY') as RunType;
  const client = supabaseServer();
  try {
    const { runId, status } = await runMRA(client, type);
    return NextResponse.json({ ok: true, runId, status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Run failed' }, { status: 500 });
  }
}
