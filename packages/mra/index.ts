import type { SupabaseClient } from '@supabase/supabase-js';
import { RunType } from './types';
import { buildUniverse } from '../strategy/universe';
import { fetchAllData } from '../data/fetch';
import { prefilter } from '../scoring/prefilter';
import { buildFeatures } from '../scoring/features';
import { rankTopN } from '../scoring/rank';
import { addAIReasoning } from '../ai/explain';
import { publishTopN } from '../io/publish';

export * from './types';

export async function runMRA(client: SupabaseClient, runType: RunType) {
  const { data: runRow, error: runErr } = await client
    .from('mra_runs')
    .insert({ run_type: runType, status: 'RUNNING', started_at: new Date().toISOString() })
    .select()
    .single();
  if (runErr || !runRow) throw runErr || new Error('failed to create run');
  const runId = runRow.id as string;
  const start = Date.now();
  try {
    const universe = await buildUniverse();
    const raw = await fetchAllData(universe);
    const candidates = prefilter(raw);
    if (candidates.length) {
      await client.from('mra_candidates').insert(
        candidates.map((c) => ({
          run_id: runId,
          symbol: c.symbol,
          market_type: c.market_type,
          liquidity: c.liquidity,
          volatility: c.volatility,
          sentiment: c.sentiment,
          tech_confluence: c.tech_confluence,
        }))
      );
    }
    const feats = buildFeatures(candidates);
    const ranked = rankTopN(feats, 10);
    const explained = await addAIReasoning(ranked);
    await publishTopN(client, runId, explained);
    await client
      .from('mra_runs')
      .update({
        status: 'DONE',
        finished_at: new Date().toISOString(),
        metrics: {
          symbols_in: universe.length,
          symbols_filtered: candidates.length,
          symbols_ranked: explained.length,
          duration_ms: Date.now() - start,
        },
      })
      .eq('id', runId);
    return { runId, status: 'DONE' as const };
  } catch (err) {
    await client
      .from('mra_runs')
      .update({
        status: 'FAILED',
        finished_at: new Date().toISOString(),
        error: String(err),
      })
      .eq('id', runId);
    throw err;
  }
}

export async function getTop10(client: SupabaseClient, date: string) {
  const { data, error } = await client
    .from('trading_opportunities')
    .select('*')
    .eq('date', date)
    .order('rank');
  if (error) throw error;
  return data ?? [];
}
