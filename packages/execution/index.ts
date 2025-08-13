import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../core/audit.ts";
import { getBrokerCredentials } from "../azure/keyVault.ts";

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
  clientOrderId?: string;
}

// Prefer fetching broker creds from Key Vault; fall back to env if needed.
let credsPromise: Promise<{ key: string; secret: string }> | null = null;
async function creds() {
  if (!credsPromise) {
    credsPromise = (async () => {
      try {
        return await getBrokerCredentials();
      } catch {
        return {
          key: Deno.env.get('BROKER_KEY') || '',
          secret: Deno.env.get('BROKER_SECRET') || '',
        };
      }
    })();
  }
  return credsPromise;
}

async function alpacaFetch(path: string, opts: RequestInit) {
  const base =
    Deno.env.get('BROKER_BASE_URL') || 'https://paper-api.alpaca.markets/v2';
  const { key, secret } = await creds();
  const headers = {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    ...(opts.headers || {}),
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
      client_order_id: order.clientOrderId,
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

export interface TrackedOrderRequest extends OrderRequest {
  tradeId: string;
  supabase: SupabaseClient;
  n?: number;
}

export async function placeAndTrackOrder(req: TrackedOrderRequest) {
  const clientOrderId =
    req.clientOrderId || makeClientOrderId(req.tradeId, req.n);
  const orderRes = await placePaperOrder({ ...req, clientOrderId });

  const { data: orderRow } = await req.supabase
    .from('orders')
    .insert({
      trade_id: req.tradeId,
      broker: 'PAPER',
      client_order_id: clientOrderId,
      type: req.type,
      side: req.side,
      qty: req.qty,
      status: (orderRes.status || 'new').toUpperCase(),
      raw_request: {
        symbol: req.symbol,
        side: req.side,
        qty: req.qty,
        type: req.type,
        time_in_force: req.tif || 'day',
        limit_price: req.limitPrice,
        stop_price: req.stopPrice,
        client_order_id: clientOrderId,
      },
      raw_response: orderRes,
    })
    .select('id')
    .single();

  let filledQty = 0;
  let status = orderRes.status as string;
  let last = orderRes;
  let loops = 0;
  while (status !== 'filled' && status !== 'canceled' && loops < 10) {
    await new Promise((r) => setTimeout(r, 1000));
    const upd = await alpacaFetch(`/v2/orders/${orderRes.id}`, {
      method: 'GET',
    });
    status = upd.status;
    const newFilled = Number(upd.filled_qty || 0);
    if (newFilled > filledQty) {
      const diff = newFilled - filledQty;
      await req.supabase.from('executions').insert({
        order_id: orderRow.id,
        price: Number(upd.filled_avg_price),
        qty: diff,
        raw_fill: upd,
      });
      filledQty = newFilled;
    }
    last = upd;
    loops++;
  }

  if (filledQty < req.qty && status !== 'canceled') {
    await alpacaFetch(`/v2/orders/${orderRes.id}`, { method: 'DELETE' }).catch(
      () => {},
    );
    status = 'canceled';
    last.status = status;
  }

  await req.supabase
    .from('orders')
    .update({
      status: status.toUpperCase(),
      price: filledQty ? Number(last.filled_avg_price) : undefined,
    })
    .eq('id', orderRow.id);

  return { orderId: orderRow.id, clientOrderId, filledQty, status };
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export async function fetchPaperBars(
  symbol: string,
  timeframe = '1D',
  limit = 100,
): Promise<Bar[]> {
  const base =
    Deno.env.get('BROKER_DATA_URL') || 'https://data.alpaca.markets';
  const { key, secret } = await creds();
  const res = await fetch(
    `${base}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`,
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
  return json.bars || [];
}