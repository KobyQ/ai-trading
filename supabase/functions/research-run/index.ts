// supabase/functions/research-run/index.ts
import { createClient } from "@supabase/supabase-js";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";

/* ----------------------------- utils & guards ----------------------------- */

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

type UiTF = "1D" | "1H";
type AlpacaTF = "1Day" | "1Hour";

function coerceTimeframe(raw?: string | null): UiTF {
  const t = (raw ?? "1D").trim().toUpperCase();
  return t === "1H" ? "1H" : "1D";
}
function mapToAlpacaTimeframe(tf: UiTF): AlpacaTF {
  return tf === "1H" ? "1Hour" : "1Day";
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

/* ----------------------------- hashing + saving ---------------------------- */

async function hashBar(b: { t: string; o: number; h: number; l: number; c: number; v: number }) {
  const str = `${b.t}|${b.o}|${b.h}|${b.l}|${b.c}|${b.v}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function saveBars(
  supabase: ReturnType<typeof createClient>,
  symbol: string,
  timeframe: UiTF,
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

/* ----------------------------- Alpaca fetcher ------------------------------ */

type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

async function fetchAlpacaBars(params: {
  symbol: string;
  timeframe: AlpacaTF;        // "1Day" | "1Hour"
  startISO?: string;          // optional; default provided below
  endISO?: string;            // optional; default provided below
  limit?: number;             // numeric; will be stringified
  feed?: "iex" | "sip";       // default "iex" (paper-friendly)
  adjustment?: "raw" | "split" | "all";
  baseUrl?: string;           // default https://data.alpaca.markets
}): Promise<Bar[]> {
  const key = Deno.env.get("BROKER_KEY");
  const secret = Deno.env.get("BROKER_SECRET");
  if (!key || !secret) throw new Error("Missing BROKER_KEY/SECRET");

  const {
    symbol,
    timeframe,
    startISO,
    endISO,
    limit = 10000,
    feed = "iex",
    adjustment = "raw",
    baseUrl = "https://data.alpaca.markets",
  } = params;

  const now = new Date();
  const defaultLookbackDays = timeframe === "1Day" ? 180 : 14;
  const start = startISO ?? new Date(now.getTime() - defaultLookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const end = endISO ?? now.toISOString();

  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/v2/stocks/bars`);
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("adjustment", adjustment);
  url.searchParams.set("feed", feed);
  url.searchParams.set("limit", String(limit));     // 👈 ensure string, not [object Object]

  const res = await fetch(url.toString(), {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Alpaca data error", res.status, text);
    throw new Error(`Alpaca data error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const raw: any[] = (json?.bars?.[symbol] ?? json?.bars ?? []) as any[];
  return raw.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

/* ---------------------------- AI summary helper ---------------------------- */

async function generateAnalysis(symbol: string, smaVal: number, rsiVal: number, regime: string) {
  const baseSummary = `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}`;

  const azureEndpoint = Deno.env.get("AZURE_OPENAI_ENDPOINT");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");
  const azureDeployment = Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? Deno.env.get("AZURE_OPENAI_DEPLOYMENT_ID");
  const azureApiVersion = Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2025-04-01-preview";

  try {
    if (azureEndpoint && azureKey && azureDeployment) {
      const prompt =
        `You are a trading assistant. Given the following data for ${symbol}: ` +
        `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}; RSI14 ${rsiVal.toFixed(2)}. ` +
        `Provide a brief summary and highlight key risks. ` +
        `Respond in JSON format with fields "summary" and "risks".`;

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

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          return {
            summary: parsed.summary ?? baseSummary,
            risks: parsed.risks ?? "High volatility",
          };
        } catch {}
      }
    }

  } catch (e) {
    console.error("generateAnalysis failed", e);
  }

  return { summary: baseSummary, risks: "High volatility" };
}

/* --------------------------------- serve --------------------------------- */

Deno.serve(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const timeframe = coerceTimeframe(searchParams.get("timeframe")); // "1D" | "1H"
    const alpacaTF = mapToAlpacaTimeframe(timeframe);                 // "1Day" | "1Hour"
    const modelId = searchParams.get("model_id") ?? undefined;
    const modelVersion = searchParams.get("model_version") ?? undefined;
    const symbols = parseSymbols(searchParams.get("symbols"));

    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(url, key);

    const results: Array<{ symbol: string; id: number }> = [];
    const errors: string[] = [];

    console.log("research-run start", { timeframe, alpacaTF, symbols, modelId, modelVersion });

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "RESEARCH_RUN",
            entity_type: "research",
            payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
          });

          // Wide default window to avoid weekend/holiday gaps
          const now = new Date();
          const lookbackDays = timeframe === "1D" ? 180 : 14;
          const startISO = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
          const endISO = now.toISOString();

          const bars = await fetchAlpacaBars({
            symbol,
            timeframe: alpacaTF,
            startISO,
            endISO,
            feed: "iex",
            limit: 10000,
            adjustment: "raw",
          });

          console.log("bars length", symbol, bars.length);

          if (bars.length === 0) {
            await insertAuditLog(supabase, {
              actor_type: "SYSTEM",
              action: "NO_DATA",
              entity_type: "market_data",
              payload_json: { symbol, timeframe, sent_timeframe: alpacaTF, startISO, endISO, feed: "iex" },
            });
            throw new Error(`No bars returned for ${symbol} ${timeframe} (sent ${alpacaTF})`);
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

          if (error) throw error;

          results.push({ symbol, id: data!.id });

          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "OPPORTUNITY_CREATED",
            entity_type: "trade_opportunity",
            entity_id: data!.id,
            payload_json: { symbol, timeframe, model_id: modelId, model_version: modelVersion },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${symbol}: ${msg}`);
          console.error("research-run failed for", symbol, e);
        }
      })
    );

    if (errors.length) throw new Error(`research-run encountered errors: ${errors.join("; ")}`);

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
