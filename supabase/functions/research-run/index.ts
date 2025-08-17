// supabase/functions/research-run/index.ts
import { createClient } from "@supabase/supabase-js";
import { fetchPaperBars } from "../_shared/execution.ts";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";

/* ----------------------------- utils & guards ----------------------------- */

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function coerceTimeframe(raw?: string | null): "1D" | "1H" {
  const t = (raw ?? "1D").toUpperCase().trim();
  if (t === "1D" || t === "1H") return t;
  console.warn(`Unknown timeframe "${raw}" -> defaulting to 1D`);
  return "1D";
}

function parseSymbols(input?: string | null): string[] {
  const envDefault = Deno.env.get("RESEARCH_SYMBOLS") ?? "AAPL";
  const base = (input ?? envDefault)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const uniq = Array.from(new Set(base));
  if (uniq.length === 0) throw new Error("No valid symbols provided");
  return uniq;
}

async function hashBar(b: { t: string; o: number; h: number; l: number; c: number; v: number }) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function saveBars(
  supabase: ReturnType<typeof createClient>,
  symbol: string,
  timeframe: "1D" | "1H",
  bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>
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
    const { error } = await supabase.from("market_data_pti").insert({
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
    if (error) throw error;
  }
}

async function generateAnalysis(symbol: string, smaVal: number, rsiVal: number, regime: string) {
  const baseSummary = `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}`;

  const azureEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  const azureDeployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? Deno.env.get("AZURE_OPENAI_DEPLOYMENT_ID");
  const azureApiVersion = Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2023-07-01-preview";
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  try {
    if (azureEndpoint && azureKey && azureDeployment) {
      const prompt =
        `You are a trading assistant. Given the following data for ${symbol}: ` +
        `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}; RSI14 ${rsiVal.toFixed(2)}. ` +
        `Provide a brief summary and highlight key risks. ` +
        `Respond in JSON format with fields "summary" and "risks".`;

      console.log("Calling Azure OpenAI", { endpoint: azureEndpoint, deployment: azureDeployment, symbol });

      const res = await fetch(
        `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "api-key": azureKey },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "You are a helpful investment research assistant." },
              { role: "user", content: prompt },
            ],
            max_tokens: 200,
            temperature: 0.2,
          }),
        }
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
          // fall through to OpenAI or base
        }
      }
    }

    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
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

/* --------------------------------- serve --------------------------------- */

/**
 * Research run generates simple trade opportunities for one or more symbols.
 *
 * Query parameters:
 * - `symbols`        Comma-separated stock symbols (default AAPL)
 * - `timeframe`      1D or 1H (default 1D)
 * - `model_id`       Optional model identifier (for audit)
 * - `model_version`  Optional model version (for audit)
 */
Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const timeframe = coerceTimeframe(searchParams.get("timeframe"));
    const modelId = searchParams.get("model_id") ?? undefined;
    const modelVersion = searchParams.get("model_version") ?? undefined;
    const symbols = parseSymbols(searchParams.get("symbols"));

    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(url, key);

    const results: Array<{ symbol: string; id: number }> = [];
    const errors: string[] = [];

    console.log("research-run start", { timeframe, symbols, modelId, modelVersion });

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "RESEARCH_RUN",
            entity_type: "research",
            payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
          });

          console.log("fetchPaperBars params", { symbol, timeframe });
          const bars = await fetchPaperBars(symbol, timeframe);

          console.log("bars length", bars?.length ?? 0);

          // Treat "no data" as an error so we don't silently return ok:true + []
          if (!bars || bars.length === 0) {
            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "NO_DATA",
              entity_type: "market_data",
              payload_json: { symbol, timeframe },
            });
            throw new Error(`No bars returned for ${symbol} ${timeframe}`);
          }

          await saveBars(supabase, symbol, timeframe, bars);

          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "MARKET_DATA_SAVED",
            entity_type: "market_data",
            payload_json: { symbol, timeframe, count: bars.length },
          });

          const closes = bars.map((b) => b.c);
          const sma20Arr = sma(closes, 20);
          const rsi14Arr = rsi(closes, 14);
          const regime = detectRegime(closes);

          const last = bars[bars.length - 1];

          // Defensive: if not enough history, default last values
          const sma20 = Number.isFinite(sma20Arr.at(-1)!) ? (sma20Arr.at(-1) as number) : last.c;
          const rsi14 = Number.isFinite(rsi14Arr.at(-1)!) ? (rsi14Arr.at(-1) as number) : 50;

          const qty = 1;
          const commission = 0.01;
          const slippageBps = 5;

          const grossEdge = last.h - last.c;
          const txCost = transactionCost(qty, commission);
          const slip = slippage(last.c, qty, slippageBps);
          const net = netEdge(grossEdge, last.c, qty, commission, slippageBps);
          const expectedReturn = net / last.c;
          const confidence = grossEdge > 0 ? Math.max(0, Math.min(1, net / grossEdge)) : 0;

          const ai = await generateAnalysis(symbol, sma20, rsi14, regime);

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
              risk_summary: `RSI ${rsi14.toFixed(2)}`,
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
      })
    );

    if (errors.length) {
      // Keep the previous behavior: fail the whole run if any symbol errored
      throw new Error(`research-run encountered errors: ${errors.join("; ")}`);
    }

    return new Response(
      JSON.stringify({ ok: true, opportunities: results }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("research-run fatal error", e);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
});
