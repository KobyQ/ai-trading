import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  nextTrailLevel,
  shouldTightenTrail,
  trailStop,
} from "../../../packages/risk/index.ts";

async function fetchLatestPrice(symbol: string) {
  const base = Deno.env.get("BROKER_DATA_URL") ??
    "https://data.alpaca.markets";
  const res = await fetch(
    `${base}/v2/stocks/${symbol}/trades/latest`,
    {
      headers: {
        "APCA-API-KEY-ID": Deno.env.get("BROKER_KEY") ?? "",
        "APCA-API-SECRET-KEY": Deno.env.get("BROKER_SECRET") ?? "",
      },
    },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.trade?.p ?? null;
}

/**
 * Simple per-minute monitor for open trades.
 *
 * Current implementation checks for trades that have been open for more than
 * 24 hours and closes them with a `TTL` reason. More sophisticated trailing
 * stop adjustments can be added later.
 */
serve(async (_req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const supabase = createClient(url, key);

  const { data: trades, error } = await supabase
    .from("trades")
    .select("id, symbol, side, qty, entry_price, stop_params_json, opened_at")
    .eq("status", "OPEN");
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let closed = 0;
  let openCount = 0;
  const exposures = new Map<string, number>();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const t of trades ?? []) {
    const price = await fetchLatestPrice(t.symbol);
    if (price == null || t.qty == null) continue;

    const opened = t.opened_at ? new Date(t.opened_at).getTime() : now;
    const sideMult = t.side === "LONG" ? 1 : -1;
    const entry = t.entry_price ?? price;
    const stop = t.stop_params_json?.stop;
    const initial = t.stop_params_json?.initial ?? stop;
    const lastLevel = t.stop_params_json?.trail_level ?? 0;
    const r = initial != null ? Math.abs(entry - initial) : null;
    const pnl = (price - entry) * t.qty * sideMult;
    const rMultiple = r ? ((price - entry) * sideMult) / r : 0;

    let shouldClose = false;
    let reason = "";
    if (now - opened > dayMs) {
      shouldClose = true;
      reason = "TTL";
    }
    if (stop != null && ((sideMult === 1 && price <= stop) || (sideMult === -1 && price >= stop))) {
      shouldClose = true;
      reason = "STOP";
    } else if (r && pnl <= -r * t.qty) {
      shouldClose = true;
      reason = "MAX_LOSS";
    }

    if (shouldClose) {
      const { error: updErr } = await supabase
        .from("trades")
        .update({
          status: "CLOSED",
          close_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (!updErr) closed++;
      continue;
    }

    if (r && shouldTightenTrail(rMultiple, lastLevel)) {
      const next = nextTrailLevel(rMultiple, lastLevel);
      if (next != null && initial != null) {
        const newStop = trailStop(entry, initial, next, t.side);
        await supabase
          .from("trades")
          .update({
            stop_params_json: {
              ...(t.stop_params_json ?? {}),
              stop: newStop,
              initial,
              trail_level: next,
            },
          })
          .eq("id", t.id);
      }
    }

    openCount++;
    exposures.set(
      t.symbol,
      (exposures.get(t.symbol) ?? 0) + price * t.qty,
    );
  }

  const maxTrades = Number(Deno.env.get("MAX_CONCURRENT_TRADES") ?? "10");
  const maxExposure = Number(Deno.env.get("MAX_GROUP_EXPOSURE_USD") ?? "100000");
  let killSwitch = false;
  if (openCount > maxTrades) killSwitch = true;
  for (const exp of exposures.values()) {
    if (Math.abs(exp) > maxExposure) {
      killSwitch = true;
      break;
    }
  }
  if (killSwitch) {
    await supabase
      .from("audit_log")
      .insert({
        actor_type: "SYSTEM",
        action: "KILL_SWITCH",
        entity_type: "PORTFOLIO",
        payload_json: {
          openCount,
          exposures: Object.fromEntries(exposures.entries()),
        },
      })
      .catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, closed, killSwitch }), {
    headers: { "content-type": "application/json" },
  });
});
