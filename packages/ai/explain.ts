import { RankedOpportunity } from '../mra/types';

export async function addAIReasoning(opps: RankedOpportunity[]): Promise<RankedOpportunity[]> {
  return opps.map((o) => ({
    ...o,
    reasoning: `Placeholder reasoning for ${o.symbol}`,
  }));
}
