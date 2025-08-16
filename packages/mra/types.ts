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
