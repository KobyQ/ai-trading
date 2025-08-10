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

export interface ClosedTrade {
  pnl: number;
  closedAt: string | Date;
}

export function dailyPnL(trades: ClosedTrade[], date = new Date()): number {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return trades
    .filter((t) => {
      const ts = new Date(t.closedAt).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    })
    .reduce((sum, t) => sum + t.pnl, 0);
}

export function weeklyPnL(trades: ClosedTrade[], date = new Date()): number {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return trades
    .filter((t) => {
      const ts = new Date(t.closedAt).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    })
    .reduce((sum, t) => sum + t.pnl, 0);
}

export interface Position {
  group: string;
  qty: number;
  price: number;
}

export function exposureByCorrelationGroup(positions: Position[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const exposure = p.qty * p.price;
    out[p.group] = (out[p.group] ?? 0) + exposure;
  }
  return out;
}

export interface OpenRisk {
  side: 'LONG' | 'SHORT';
  qty: number;
  entry: number;
  stop: number;
}

export function totalOpenRisk(trades: OpenRisk[]): number {
  return trades.reduce((sum, t) => {
    const risk =
      t.side === 'LONG'
        ? Math.max(0, t.entry - t.stop) * t.qty
        : Math.max(0, t.stop - t.entry) * t.qty;
    return sum + risk;
  }, 0);
}
