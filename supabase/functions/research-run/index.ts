import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars } from "../../packages/execution/index.ts";
import { sma, rsi, detectRegime } from "../../packages/strategy/index.ts";

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
    })
    .select("id")
    .single();
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true, opportunityId: data.id }), {
    headers: { "content-type": "application/json" },
  });
});
