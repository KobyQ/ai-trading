export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) {
      out.push(NaN);
      continue;
    }
    const slice = values.slice(i + 1 - period, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  // simple RSI (placeholder)
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - values[j - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = losses === 0 ? 100 : gains / (losses || 1e-9);
    out[i] = 100 - (100 / (1 + rs));
  }
  return out;
}

export function detectRegime(close: number[]): 'TREND' | 'RANGE' | 'HIGH_VOL' | 'LOW_VOL' {
  // toy regime: slope sign + stdev magnitude
  const n = close.length;
  if (n < 20) return 'RANGE';
  const last20 = close.slice(-20);
  const slope = last20[last20.length - 1] - last20[0];
  const mean = last20.reduce((a, b) => a + b, 0) / last20.length;
  const stdev = Math.sqrt(last20.reduce((a, b) => a + (b - mean) ** 2, 0) / last20.length);
  if (stdev > mean * 0.02) return 'HIGH_VOL';
  if (Math.abs(slope) < mean * 0.002) return 'RANGE';
  return 'TREND';
}
