export function sizeByVol(equityUSD: number, atrUSD: number, maxRiskPct = 0.01) {
  const maxRiskUSD = equityUSD * maxRiskPct;
  if (atrUSD <= 0) return 0;
  const qty = Math.floor(maxRiskUSD / atrUSD);
  return Math.max(qty, 0);
}

export function sizeWithRiskCaps(
  equityUSD: number,
  atrUSD: number,
  dayRiskUSD: number,
  weekRiskUSD: number,
  perTradePct = 0.01,
  dayPct = 0.02,
  weekPct = 0.05,
) {
  // base position by volatility
  const baseQty = sizeByVol(equityUSD, atrUSD, perTradePct);
  if (atrUSD <= 0) return 0;
  // remaining risk capital for day and week
  const remainingDay = Math.max(equityUSD * dayPct - dayRiskUSD, 0);
  const remainingWeek = Math.max(equityUSD * weekPct - weekRiskUSD, 0);
  const dayQty = Math.floor(remainingDay / atrUSD);
  const weekQty = Math.floor(remainingWeek / atrUSD);
  return Math.max(Math.min(baseQty, dayQty, weekQty), 0);
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