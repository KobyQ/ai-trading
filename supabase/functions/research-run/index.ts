import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars, Bar } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";

async function hashBar(b: Bar) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str),
  );
  return Array.from(new Uint8Array(buf))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

async function saveBars(
  supabase: SupabaseClient,
  symbol: string,
  timeframe: string,
  bars: Bar[],
) {
  for (const b of bars) {
    const hash = await hashBar(b);
    const { data: existing } = await supabase
      .from("market_data_pti")
      .select("hash, revision")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe.toLowerCase())
      .eq("ts", b.t)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.hash === hash) continue;

    const revision = existing ? existing.revision + 1 : 0;
    await supabase.from("market_data_pti").insert({
      symbol,
      timeframe: timeframe.toLowerCase(),
      ts: b.t,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
      revision,
      hash,
    });
  }
}

/**
 * Research run generates a simple trade opportunity for a given symbol.
 *
 * Query parameters:
 * - `symbol`   Stock symbol (default AAPL)
 * - `timeframe` 1D or 1H (default 1D)
 */
serve(async (req) => {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "AAPL";
  const timeframe = searchParams.get("timeframe") ?? "1D";
  const modelId = searchParams.get("model_id");
  const modelVersion = searchParams.get("model_version");
  const bars = await fetchPaperBars(symbol, timeframe);
  const closes = bars.map((b) => b.c);
  const sma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const regime = detectRegime(closes);
  const last = bars[bars.length - 1];

  const aiSummary = `Regime ${regime}; SMA20 ${sma20.at(-1)?.toFixed(2)}, RSI14 ${rsi14.at(-1)?.toFixed(2)}`;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const supabase = createClient(url, key);

  await insertAuditLog(supabase, {
    actor_type: "SYSTEM",
    action: "RESEARCH_RUN",
    entity_type: "research",
    payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
  });

  await saveBars(supabase, symbol, timeframe, bars);
  await insertAuditLog(supabase, {
    actor_type: "SYSTEM",
    action: "MARKET_DATA_SAVED",
    entity_type: "market_data",
    payload_json: { symbol, timeframe, count: bars.length },
  });

  const { data, error } = await supabase
    .from("trade_opportunities")
    .insert({
      symbol,
      side: "LONG",
      timeframe: timeframe.toLowerCase(),
      entry_plan_json: { price: last.c },
      stop_plan_json: { stop: last.l },
      take_profit_json: { tp: last.h },
      risk_summary: `RSI ${rsi14.at(-1)?.toFixed(2)}`,
      expected_return: 1,
      confidence: 0.5,
      ai_summary: aiSummary,
      ai_risks: "High volatility",
      model_id: modelId,
      model_version: modelVersion,
    })
    .select("id")
    .single();
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  await insertAuditLog(supabase, {
    actor_type: "SYSTEM",
    action: "OPPORTUNITY_CREATED",
    entity_type: "trade_opportunity",
    entity_id: data.id,
    payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
  });

  return new Response(JSON.stringify({ ok: true, opportunityId: data.id }), {
    headers: { "content-type": "application/json" },
  });
});
