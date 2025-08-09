export function sizeByVol(equityUSD: number, atrUSD: number, maxRiskPct=0.01){
  const maxRiskUSD = equityUSD * maxRiskPct;
  if (atrUSD<=0) return 0;
  const qty = Math.floor(maxRiskUSD / atrUSD);
  return Math.max(qty, 0);
}
export function shouldTightenTrail(rMultiple: number){
  // tighten on discrete thresholds
  return rMultiple >= 0.5; // placeholder
}
