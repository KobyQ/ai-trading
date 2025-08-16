import type { SupabaseClient } from '@supabase/supabase-js';
import { RankedOpportunity } from '../mra/types';

export async function publishTopN(client: SupabaseClient, runId: string, opps: RankedOpportunity[]) {
  if (!opps.length) return;
  await client.from('trading_opportunities').insert(
    opps.map((o) => ({
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
