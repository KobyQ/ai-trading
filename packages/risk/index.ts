export function sizeByVol(equityUSD: number, atrUSD: number, maxRiskPct=0.01){
  const maxRiskUSD = equityUSD * maxRiskPct;
  if (atrUSD<=0) return 0;
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
export function shouldTightenTrail(rMultiple: number){
  // tighten on discrete thresholds
  return rMultiple >= 0.5; // placeholder
}
