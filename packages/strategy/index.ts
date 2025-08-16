import { sizeWithRiskCaps } from '../risk';

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

export function bollinger(values: number[], period=20, mult=2){
  const mid = sma(values, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i=0;i<values.length;i++){
    if (i+1<period){
      upper.push(NaN); lower.push(NaN); continue;
    }
    const slice = values.slice(i+1-period, i+1);
    const mean = mid[i];
    const stdev = Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/period);
    upper[i] = mean + stdev*mult;
    lower[i] = mean - stdev*mult;
  }
  return { mid, upper, lower };
}

export function smaCrossSignal(prices: number[], shortP=10, longP=20): number[]{
  const short = sma(prices, shortP);
  const long = sma(prices, longP);
  const out: number[] = new Array(prices.length).fill(0);
  for (let i=1;i<prices.length;i++){
    if (isNaN(short[i]) || isNaN(long[i]) || isNaN(short[i-1]) || isNaN(long[i-1])) continue;
    const prevDiff = short[i-1]-long[i-1];
    const diff = short[i]-long[i];
    if (prevDiff<=0 && diff>0) out[i]=1;
    else if (prevDiff>=0 && diff<0) out[i]=-1;
  }
  return out;
}

export function meanReversionSignal(close: number[], rsiPeriod=14, bbPeriod=20, bbMult=2){
  const bb = bollinger(close, bbPeriod, bbMult);
  const r = rsi(close, rsiPeriod);
  return close.map((c,i)=>{
    if (c<bb.lower[i] && r[i]<30) return 1;
    if (c>bb.upper[i] && r[i]>70) return -1;
    return 0;
  });
}

export function atr(high: number[], low: number[], close: number[], period=14){
  const tr: number[] = [];
  for (let i=0;i<close.length;i++){
    const prevClose = i>0?close[i-1]:close[i];
    const highLow = high[i]-low[i];
    const highClose = Math.abs(high[i]-prevClose);
    const lowClose = Math.abs(low[i]-prevClose);
    tr.push(Math.max(highLow, highClose, lowClose));
  }
  return sma(tr, period);
}

function percentileRank(values: number[], value: number){
  const sorted = values.slice().sort((a,b)=>a-b);
  let count=0;
  for (const v of sorted){ if (v<=value) count++; }
  return (count / sorted.length) * 100;
}

export function atrPercentileFilter(high: number[], low: number[], close: number[], atrPeriod=14, lookback=100, threshold=80){
  const atrVals = atr(high, low, close, atrPeriod);
  const recent = atrVals.slice(-lookback);
  const last = atrVals[atrVals.length-1];
  const pct = percentileRank(recent, last);
  return pct >= threshold;
}

export function transactionCost(qty: number, commissionPerUnit: number){
  return qty * commissionPerUnit;
}

export function slippage(price: number, qty: number, bps: number){
  return price * qty * (bps/10000);
}

export function netEdge(grossEdge: number, price: number, qty: number, commissionPerUnit: number, slippageBps: number){
  return grossEdge - transactionCost(qty, commissionPerUnit) - slippage(price, qty, slippageBps);
}

export function calcTradeSize(equityUSD: number, atrUSD: number, dayRiskUSD: number, weekRiskUSD: number){
  return sizeWithRiskCaps(equityUSD, atrUSD, dayRiskUSD, weekRiskUSD);
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
