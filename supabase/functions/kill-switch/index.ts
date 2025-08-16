import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

async function alpacaFetch(path: string, opts: RequestInit = {}) {
  const base = Deno.env.get('BROKER_BASE_URL') ?? 'https://paper-api.alpaca.markets/v2';
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
  if (res.status === 204) return null;
  return res.json();
}

serve(async (_req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: 'missing env' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
  const supabase = createClient(url, key);

  let ordersCanceled = 0;
  let positionsClosed = 0;
  try {
    const res = await alpacaFetch('/orders', { method: 'DELETE' });
    ordersCanceled = Array.isArray(res) ? res.length : 0;
  } catch (e) {
    console.error(e);
  }
  try {
    const res = await alpacaFetch('/positions', { method: 'DELETE' });
    positionsClosed = Array.isArray(res) ? res.length : 0;
  } catch (e) {
    console.error(e);
  }

  const { error } = await supabase
    .from('trades')
    .update({
      status: 'CLOSED',
      close_reason: 'KILL_SWITCH',
      closed_at: new Date().toISOString(),
    })
    .neq('status', 'CLOSED');
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, ordersCanceled, positionsClosed }),
    { headers: { 'content-type': 'application/json' } },
  );
});
