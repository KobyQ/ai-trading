import { Candidate } from '../mra/types';

export function prefilter(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.liquidity > 0);
}
