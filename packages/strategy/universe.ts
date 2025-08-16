import { UniverseSymbol } from '../mra/types';

export async function buildUniverse(): Promise<UniverseSymbol[]> {
  // placeholder universe; real implementation would query lists per market
  return [
    { symbol: 'EURUSD', market_type: 'forex' },
    { symbol: 'AAPL', market_type: 'stock' },
    { symbol: 'BTCUSDT', market_type: 'crypto' },
    { symbol: 'SPY', market_type: 'index' },
  ];
}
