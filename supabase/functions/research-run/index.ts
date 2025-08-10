import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchPaperBars } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";

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

  const azureEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  const azureDeployment =
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ??
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT_ID");
  const azureApiVersion =
    Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2023-07-01-preview";

  let aiSummary =
    `Regime ${regime}; SMA20 ${sma20.at(-1)?.toFixed(2)}, RSI14 ${rsi14.at(-1)?.toFixed(2)}`;
  let aiRisks = "High volatility";

  if (azureEndpoint && azureKey && azureDeployment) {
    try {
      const prompt =
        `You are a trading assistant. Given the following data for ${symbol} ` +
        `with timeframe ${timeframe}: Regime ${regime}; SMA20 ${
          sma20.at(-1)?.toFixed(2)
        }; RSI14 ${rsi14.at(-1)?.toFixed(2)}. ` +
        `Provide a brief summary and highlight key risks. ` +
        `Respond in JSON format with fields "summary" and "risks".`;
      const azureRes = await fetch(
        `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "api-key": azureKey,
          },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  "You are a helpful investment research assistant.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 200,
            temperature: 0.2,
          }),
        },
      );
      const azureJson = await azureRes.json();
      const content = azureJson.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        aiSummary = parsed.summary ?? aiSummary;
        aiRisks = parsed.risks ?? aiRisks;
      }
    } catch (e) {
      console.error("Azure OpenAI error", e);
    }
  }

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
      ai_risks: aiRisks,
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
