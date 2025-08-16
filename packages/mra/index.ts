import type { SupabaseClient } from '@supabase/supabase-js';

export type RunType = 'DAILY' | 'MIDDAY' | 'US_PREOPEN';

export interface UniverseSymbol {
  symbol: string;
  market_type: 'forex' | 'stock' | 'crypto' | 'index';
}

export interface Candidate extends UniverseSymbol {
  liquidity: number;
  volatility: number;
  sentiment: number;
  tech_confluence: number;
}

export interface RankedOpportunity {
  rank: number;
  symbol: string;
  market_type: 'forex' | 'stock' | 'crypto' | 'index';
  bias: 'long' | 'short';
  entry_zone: Record<string, any>;
  target_zone: Record<string, any>;
  stop_loss: number;
  confidence_score: number;
  reasoning?: string;
  score: number;
}

export async function buildUniverse(): Promise<UniverseSymbol[]> {
  // placeholder universe; real implementation would query lists per market
  return [
    { symbol: 'EURUSD', market_type: 'forex' },
    { symbol: 'AAPL', market_type: 'stock' },
    { symbol: 'BTCUSDT', market_type: 'crypto' },
    { symbol: 'SPY', market_type: 'index' },
  ];
}

export async function fetchAllData(universe: UniverseSymbol[]): Promise<Candidate[]> {
  // stub: assign deterministic values for repeatability
  return universe.map((u, i) => ({
    ...u,
    liquidity: 100 - i * 10,
    volatility: 50 + i * 5,
    sentiment: 50,
    tech_confluence: 50,
  }));
}

export function prefilter(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.liquidity > 0);
}

export function rankTopN(candidates: Candidate[], n: number): RankedOpportunity[] {
  const ranked = candidates
    .map((c) => {
      const score =
        0.3 * c.volatility +
        0.2 * c.liquidity +
        0.3 * c.sentiment +
        0.2 * c.tech_confluence;
      return {
        rank: 0,
        symbol: c.symbol,
        market_type: c.market_type,
        bias: 'long' as const,
        entry_zone: { min: 0, max: 0 },
        target_zone: { t1: 0, t2: 0 },
        stop_loss: 0,
        confidence_score: Math.round(score),
        reasoning: '',
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((o, i) => ({ ...o, rank: i + 1 }));
  return ranked;
}

export async function addAIReasoning(opps: RankedOpportunity[]): Promise<RankedOpportunity[]> {
  return opps.map((o) => ({
    ...o,
    reasoning: `Placeholder reasoning for ${o.symbol}`,
  }));
}

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
    const ranked = rankTopN(candidates, 10);
    const explained = await addAIReasoning(ranked);
    if (explained.length) {
      await client.from('trading_opportunities').insert(
        explained.map((o) => ({
          run_id: runId,
          rank: o.rank,
          date: new Date().toISOString().slice(0, 10),
          symbol: o.symbol,
          market_type: o.market_type,
          bias: o.bias,
          entry_zone: o.entry_zone,
          target_zone: o.target_zone,
          stop_loss: o.stop_loss,
          confidence_score: o.confidence_score,
          reasoning: o.reasoning,
        }))
      );
    }
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
