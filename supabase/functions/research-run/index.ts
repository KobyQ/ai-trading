import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { fetchPaperBars, Bar } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

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

async function generateAnalysis(
  symbol: string,
  smaVal: number,
  rsiVal: number,
  regime: string,
) {
  const baseSummary =
    `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}`;

  const azureEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  const azureDeployment =
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ??
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT_ID");
  const azureApiVersion =
    Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2023-07-01-preview";
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  try {
    if (azureEndpoint && azureKey && azureDeployment) {
      const prompt =
        `You are a trading assistant. Given the following data for ${symbol}: ` +
        `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}; RSI14 ${rsiVal.toFixed(2)}. ` +
        `Provide a brief summary and highlight key risks. ` +
        `Respond in JSON format with fields "summary" and "risks".`;
      console.log("Calling Azure OpenAI", {
        endpoint: azureEndpoint,
        deployment: azureDeployment,
        symbol,
      });
      const res = await fetch(
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
                content: "You are a helpful investment research assistant.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 200,
            temperature: 0.2,
          }),
        },
      );
      console.log("Azure OpenAI response status", res.status);
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          return {
            summary: parsed.summary ?? baseSummary,
            risks: parsed.risks ?? "High volatility",
          };
        } catch {
          // fall through
        }
      }
    }

    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content:
                `Given the following market data for ${symbol}: Regime ${regime}, ` +
                `SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}. ` +
                `Provide a short trading summary and key risks.`,
            },
          ],
          max_tokens: 120,
        }),
      });
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? "";
      const [summary, risks] = text.split("Risks:");
      return {
        summary: summary?.trim() || baseSummary,
        risks: risks?.trim() || "High volatility",
      };
    }
  } catch (e) {
    console.error("generateAnalysis failed", e);
  }

  return { summary: baseSummary, risks: "High volatility" };
}

/**
 * Research run generates simple trade opportunities for one or more symbols.
 *
 * Query parameters:
 * - `symbols`   Comma-separated stock symbols (default AAPL)
 * - `timeframe` 1D or 1H (default 1D)
 * - `model_id`  Optional model identifier (for audit)
 * - `model_version` Optional model version (for audit)
 */
Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const timeframe = searchParams.get("timeframe") ?? "1D";
    const modelId = searchParams.get("model_id") ?? undefined;
    const modelVersion = searchParams.get("model_version") ?? undefined;
    const symbolsParam =
      searchParams.get("symbols") ?? Deno.env.get("RESEARCH_SYMBOLS") ?? "AAPL";
    const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean);

    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(url, key);

    const results: { symbol: string; id: string }[] = [];
    const errors: string[] = [];
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "RESEARCH_RUN",
            entity_type: "research",
            payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
          });

          const bars = await fetchPaperBars(symbol, timeframe);
          if (!bars.length) return;

          await saveBars(supabase, symbol, timeframe, bars);
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "MARKET_DATA_SAVED",
            entity_type: "market_data",
            payload_json: { symbol, timeframe, count: bars.length },
          });

          const closes = bars.map((b) => b.c);
          const sma20 = sma(closes, 20);
          const rsi14 = rsi(closes, 14);
          const regime = detectRegime(closes);
          const last = bars[bars.length - 1];

          const qty = 1;
          const commission = 0.01;
          const slippageBps = 5;
          const grossEdge = last.h - last.c;
          const txCost = transactionCost(qty, commission);
          const slip = slippage(last.c, qty, slippageBps);
          const net = netEdge(grossEdge, last.c, qty, commission, slippageBps);
          const expectedReturn = net / last.c;
          const confidence = grossEdge > 0
            ? Math.max(0, Math.min(1, net / grossEdge))
            : 0;

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
              entry_plan_json: {
                price: last.c,
                transaction_cost: txCost,
                slippage: slip,
                net_edge: net,
              },
              stop_plan_json: { stop: last.l },
              take_profit_json: { tp: last.h },
              risk_summary: `RSI ${rsi14.at(-1)?.toFixed(2)}`,
              expected_return: expectedReturn,
              confidence,
              ai_summary: ai.summary,
              ai_risks: ai.risks,
              model_id: modelId,
              model_version: modelVersion,
            })
            .select("id")
            .single();

          if (error) {
            console.error("insert trade_opportunities failed for", symbol, error);
            throw error;
          }

          if (data) {
            results.push({ symbol, id: data.id });

            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "OPPORTUNITY_CREATED",
              entity_type: "trade_opportunity",
              entity_id: data.id,
              payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${symbol}: ${msg}`);
          console.error("research-run failed for", symbol, e);
        }
      }),
    );

    if (errors.length) {
      const message = `research-run encountered errors: ${errors.join("; ")}`;
      throw new Error(message);
    }

    return new Response(JSON.stringify({ ok: true, opportunities: results }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("research-run fatal error", e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
