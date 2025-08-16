export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  for (let i=0;i<values.length;i++){
    if (i+1<period) { out.push(NaN); continue; }
    const slice = values.slice(i+1-period, i+1);
    out.push(slice.reduce((a,b)=>a+b,0)/period);
  }
  return out;
}
export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gainSum += diff; else lossSum -= diff;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return out;
}
export function detectRegime(close: number[]): 'TREND'|'RANGE'|'HIGH_VOL'|'LOW_VOL' {
  // toy regime: slope sign + stdev magnitude
  const n = close.length;
  if (n < 20) return 'RANGE';
  const last20 = close.slice(-20);
  const slope = last20[last20.length-1]-last20[0];
  const mean = last20.reduce((a,b)=>a+b,0)/last20.length;
  const stdev = Math.sqrt(last20.reduce((a,b)=>a+(b-mean)**2,0)/last20.length);
  if (stdev > mean*0.02) return 'HIGH_VOL';
  if (Math.abs(slope) < mean*0.002) return 'RANGE';
  return 'TREND';
}
