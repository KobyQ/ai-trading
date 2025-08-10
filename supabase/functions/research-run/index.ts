import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";

async function generateAnalysis(symbol: string, smaVal: number, rsiVal: number, regime: string) {
  const key = Deno.env.get("OPENAI_API_KEY");
  const baseSummary = `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}`;
  if (!key) {
    return { summary: baseSummary, risks: "High volatility" };
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `Given the following market data for ${symbol}: Regime ${regime}, SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}. Provide a short trading summary and key risks.`,
        }],
        max_tokens: 120,
      }),
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "";
    const [summary, risks] = text.split("Risks:");
    return { summary: summary?.trim() || baseSummary, risks: risks?.trim() || "High volatility" };
  } catch (_) {
    return { summary: baseSummary, risks: "High volatility" };
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
  const timeframe = searchParams.get("timeframe") ?? "1D";
  const symbolsParam =
    searchParams.get("symbols") ?? Deno.env.get("RESEARCH_SYMBOLS") ?? "AAPL";
  const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const supabase = createClient(url, key);

  const results: { symbol: string; id: string }[] = [];
  for (const symbol of symbols) {
    try {
      const bars = await fetchPaperBars(symbol, timeframe);
      if (!bars.length) continue;
      const closes = bars.map((b) => b.c);
      const sma20 = sma(closes, 20);
      const rsi14 = rsi(closes, 14);
      const regime = detectRegime(closes);
      const last = bars[bars.length - 1];
      const ai = await generateAnalysis(
        symbol,
        sma20.at(-1) ?? 0,
        rsi14.at(-1) ?? 0,
        regime,
      );

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
          ai_summary: ai.summary,
          ai_risks: ai.risks,
        })
        .select("id")
        .single();
      if (!error && data) {
        results.push({ symbol, id: data.id });
      }
    } catch (_) {
      continue;
    }
  }

  return new Response(JSON.stringify({ ok: true, opportunities: results }), {
    headers: { "content-type": "application/json" },
  });
});
