import { UniverseSymbol, Candidate } from '../mra/types';

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
