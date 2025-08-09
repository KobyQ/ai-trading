export type Timeframe = '1d'|'1h';
export type Side = 'LONG'|'SHORT';
export interface Opportunity {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  side: Side;
  expectedReturn: number;
  confidence: number;
  aiSummary: string;
  aiRisks: string;
  createdAt: string;
}
