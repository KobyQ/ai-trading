import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "./audit.ts";

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
    return Deno.env.get(name) ?? undefined;
  }
  if (typeof process !== "undefined") {
    return process.env[name];
  }
  return undefined;
}

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
  const base = Deno.env.get('BROKER_BASE_URL') ?? 'https://paper-api.alpaca.markets/v2';
  const headers = {
    'APCA-API-KEY-ID': process.env.BROKER_KEY,
    'APCA-API-SECRET-KEY': process.env.BROKER_SECRET,
    ...(opts.headers ?? {})
  } as Record<string, string>;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function placePaperOrder(
  order: OrderRequest,
  supabase?: SupabaseClient,
) {
  const client =
    supabase ||
    (() => {
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      return url && key ? createClient(url, key) : undefined;
    })();

  if (client) {
    await insertAuditLog(client, {
      actor_type: 'SYSTEM',
      action: 'PLACE_ORDER',
      entity_type: 'order',
      payload_json: order,
    });
  }

  const res = await alpacaFetch('/orders', {
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

  if (client) {
    await insertAuditLog(client, {
      actor_type: 'SYSTEM',
      action: 'ORDER_RESPONSE',
      entity_type: 'order',
      payload_json: res,
    });
  }
  return res;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

async function getBrokerCreds() {
  const key = getEnv('BROKER_KEY');
  const secret = getEnv('BROKER_SECRET');
  if (!key || !secret) {
    throw new Error('Missing broker credentials');
  }
  return { key, secret };
}

export async function fetchPaperBars(symbol: string, timeframe = '1D', limit = 100): Promise<Bar[]> {
  const base = 'https://data.alpaca.markets/v2';
  const { key, secret } = await getBrokerCreds();
  const res = await fetch(
    `${base}/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`,
    {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
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
