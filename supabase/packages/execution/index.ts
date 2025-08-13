import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../core/audit.ts";

export function makeClientOrderId(tradeId: string, n=1){
  return `${tradeId}-${n}`;
}

export interface OrderRequest {
  symbol: string; side: 'buy'|'sell'; qty: number;
  type: 'market'|'limit'|'stop'|'stop_limit';
  limitPrice?: number; stopPrice?: number; tif?: 'day'|'ioc'|'fok';
}

import { getBrokerCredentials } from "../azure/keyVault.ts";
let credsPromise: Promise<{ key: string; secret: string }> | null = null;
async function creds(){
  if(!credsPromise){
    credsPromise = getBrokerCredentials();
  }
  return credsPromise;
}

async function alpacaFetch(path: string, opts: RequestInit){
  const base = process.env.BROKER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
  const { key, secret } = await creds();
  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    ...(opts.headers || {})
  } as Record<string, string>;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  if (!res.ok){
    const text = await res.text();
    throw new Error(`Alpaca error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function placePaperOrder(
  order: OrderRequest,
  supabase?: SupabaseClient,
){
  const client = supabase || (() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

  const res = await alpacaFetch('/v2/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      type: order.type,
      time_in_force: order.tif || 'day',
      limit_price: order.limitPrice,
      stop_price: order.stopPrice,
    })
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
  t: string; o: number; h: number; l: number; c: number; v: number;
}

export async function fetchPaperBars(symbol: string, timeframe='1D', limit=100): Promise<Bar[]>{
  const base = process.env.BROKER_DATA_URL || 'https://data.alpaca.markets';
  const { key, secret } = await creds();
  const res = await fetch(`${base}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret
    }
  });
  if (!res.ok){
    const text = await res.text();
    throw new Error(`Alpaca data error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.bars || [];
}

