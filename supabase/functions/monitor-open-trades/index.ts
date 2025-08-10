import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars } from "../_shared/execution.ts";

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
    .select("id, symbol, side, opportunity_id, opened_at")
    .eq("status", "OPEN");
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const { data: limits } = await supabase
    .from("risk_limits")
    .select("cap_type, value")
    .eq("scope", "TRADE")
    .eq("active", true);
  const pctLimit = limits?.find((l) => l.cap_type === "PCT")?.value as
    | number
    | undefined;

  let closed = 0;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const t of trades ?? []) {
    const opened = t.opened_at ? new Date(t.opened_at).getTime() : now;

    const { data: opp } = await supabase
      .from("trade_opportunities")
      .select("entry_plan_json, stop_plan_json, take_profit_json")
      .eq("id", t.opportunity_id)
      .single();
    const entry = opp?.entry_plan_json?.price ?? null;
    const stop = opp?.stop_plan_json?.stop ?? null;
    const target = opp?.take_profit_json?.tp ?? null;

    let reason = "";
    if (entry && stop && pctLimit) {
      const riskPct =
        t.side === "LONG"
          ? ((entry - stop) / entry) * 100
          : ((stop - entry) / entry) * 100;
      if (riskPct > pctLimit) reason = "RISK";
    }

    if (!reason && stop !== null && target !== null) {
      const bars = await fetchPaperBars(t.symbol, "1Min", 1);
      const price = bars.at(-1)?.c;
      if (price !== undefined) {
        if (t.side === "LONG") {
          if (price <= stop) reason = "STOP";
          else if (price >= target) reason = "TARGET";
        } else {
          if (price >= stop) reason = "STOP";
          else if (price <= target) reason = "TARGET";
        }
      }
    }

    if (!reason && now - opened > dayMs) {
      reason = "TTL";
    }

    if (reason) {
      const { error: updErr } = await supabase
        .from("trades")
        .update({
          status: "CLOSED",
          close_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (!updErr) closed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, closed }), {
    headers: { "content-type": "application/json" },
  });
});
