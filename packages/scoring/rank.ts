import { Candidate, RankedOpportunity } from '../mra/types';

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
