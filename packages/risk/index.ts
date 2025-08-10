export function sizeByVol(equityUSD: number, atrUSD: number, maxRiskPct = 0.01) {
  const maxRiskUSD = equityUSD * maxRiskPct;
  if (atrUSD <= 0) return 0;
  const qty = Math.floor(maxRiskUSD / atrUSD);
  return Math.max(qty, 0);
}

// Determine the next trailing stop level in 0.5R increments.
export function nextTrailLevel(rMultiple: number, lastLevel = 0) {
  const step = 0.5;
  const level = Math.floor(rMultiple / step) * step;
  return level > lastLevel ? level : null;
}

// Calculate a new stop price based on the trail level.
export function trailStop(
  entry: number,
  initialStop: number,
  level: number,
  side: 'LONG' | 'SHORT',
) {
  const r = Math.abs(entry - initialStop);
  const move = Math.max(0, level - 0.5) * r;
  return side === 'LONG' ? entry + move : entry - move;
}

export function shouldTightenTrail(rMultiple: number, lastLevel = 0) {
  // tighten when we cross discrete thresholds like +0.5R, +1R, etc.
  return nextTrailLevel(rMultiple, lastLevel) !== null;
}
