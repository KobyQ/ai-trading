export function makeClientOrderId(tradeId: string, n = 1) {
  return `${tradeId}-${n}`;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  limitPrice?: number;
  stopPrice?: number;
  tif?: 'day' | 'ioc' | 'fok';
}

async function alpacaFetch(path: string, opts: RequestInit) {
  const base = Deno.env.get('BROKER_BASE_URL') ?? 'https://paper-api.alpaca.markets';
  const headers = {
    'APCA-API-KEY-ID': Deno.env.get('BROKER_KEY') ?? '',
    'APCA-API-SECRET-KEY': Deno.env.get('BROKER_SECRET') ?? '',
    ...(opts.headers ?? {})
  } as Record<string, string>;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function placePaperOrder(order: OrderRequest) {
  return alpacaFetch('/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      type: order.type,
      time_in_force: order.tif ?? 'day',
      limit_price: order.limitPrice,
      stop_price: order.stopPrice,
    }),
  });
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export async function fetchPaperBars(symbol: string, timeframe = '1D', limit = 100): Promise<Bar[]> {
  const base = Deno.env.get('BROKER_DATA_URL') ?? 'https://data.alpaca.markets';
  const res = await fetch(
    `${base}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`,
    {
      headers: {
        'APCA-API-KEY-ID': Deno.env.get('BROKER_KEY') ?? '',
        'APCA-API-SECRET-KEY': Deno.env.get('BROKER_SECRET') ?? '',
      },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca data error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.bars ?? [];
}
