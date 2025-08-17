// supabase/functions/research-run/index.ts
import { createClient } from "@supabase/supabase-js";
import { sma, rsi, detectRegime } from "../_shared/strategy.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { netEdge, transactionCost, slippage } from "../../../packages/strategy/index.ts";

/* ----------------------------- utils & guards ----------------------------- */

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function requireBoolEnv(name: string, def = "false") {
  const v = (Deno.env.get(name) ?? def).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const REQUIRE_AZURE = requireBoolEnv("REQUIRE_AZURE", "true");

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

function nearlyEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
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

/* ----------------------------- fetch helpers ------------------------------ */

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callWithRetry(
  fn: () => Promise<Response>,
  maxAttempts = 3
): Promise<Response> {
  let delay = 500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fn();
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === maxAttempts) return res;
      const ra = res.headers.get("retry-after");
      const d = ra ? Number(ra) * 1000 : delay;
      await new Promise((r) => setTimeout(r, d));
      delay = Math.min(delay * 2, 4000);
      continue;
    }
    return res;
  }
  throw new Error("Retries exhausted");
}

/* ----------------------------- Alpaca fetcher ------------------------------ */

type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

async function fetchAlpacaBars(params: {
  symbol: string;
  timeframe: AlpacaTF;
  startISO?: string;
  endISO?: string;
  limit?: number;
  feed?: "iex" | "sip";
  adjustment?: "raw" | "split" | "all";
  baseUrl?: string;
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
  url.searchParams.set("limit", String(limit));

  const res = await callWithRetry(
    () =>
      fetchWithTimeout(
        url.toString(),
        {
          headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
        },
        15000
      ),
    3
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Alpaca data error", res.status, text);
    throw new Error(`Alpaca data error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const raw: any[] = (json?.bars?.[symbol] ?? json?.bars ?? []) as any[];
  const cleaned = raw
    .map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
    .filter((b) => Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c));
  return cleaned;
}

/* ---------------------------- AI summary helper ---------------------------- */

function deriveHeuristicRisk(rsiVal: number, regime: string) {
  const risks: string[] = [];
  if (rsiVal >= 70) risks.push("Overbought risk");
  if (rsiVal <= 30) risks.push("Oversold whipsaw risk");
  if (/bear/i.test(regime)) risks.push("Downtrend continuation risk");
  if (/sideways|range/i.test(regime)) risks.push("Range breakdown risk");
  if (risks.length === 0) risks.push("Normal market fluctuations");
  return risks.join("; ");
}

type AIResult = {
  summary: string;
  risks: string;
  ai_source: "azure" | "heuristic";
  ai_request_id?: string | null;
  ai_latency_ms?: number;
  ai_ratelimit_remaining_tokens?: string | null;
  ai_echo_validated?: boolean;
  ai_fallback_used?: "json_object" | "heuristic" | null;
};

/* ----------------------------- Azure utilities ----------------------------- */

function normalizeEndpoint(ep?: string | null) {
  if (!ep) return "";
  const trimmed = ep.trim().replace(/\/+$/, ""); // remove trailing slashes
  // Make sure it doesn't already contain '/openai'
  return trimmed.replace(/\/openai$/i, "");
}

const azureEndpointRaw = Deno.env.get("AZURE_OPENAI_ENDPOINT");
const azureEndpoint = normalizeEndpoint(azureEndpointRaw);
const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY")?.trim();
const azureDeployment = (Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? Deno.env.get("AZURE_OPENAI_DEPLOYMENT_ID"))?.trim();
const azureApiVersion = (Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2024-06-01").trim();

let azurePreflightOk: boolean | null = null;
let azurePreflightLastStatus: number | null = null;
let azurePreflightLastBody: string | null = null;

async function azurePreflight(): Promise<boolean> {
  if (!azureEndpoint || !azureKey || !azureDeployment) {
    azurePreflightOk = false;
    azurePreflightLastStatus = 0;
    azurePreflightLastBody = "Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY or AZURE_OPENAI_DEPLOYMENT";
    return false;
  }
  const url = `${azureEndpoint}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": azureKey },
        body: JSON.stringify({
          messages: [{ role: "user", content: "ping" }],
          max_completion_tokens: 200,
        }),
      },
      8000
    );

    azurePreflightLastStatus = res.status;
    if (!res.ok) {
      // capture body for diagnostics
      try {
        azurePreflightLastBody = await res.text();
      } catch {
        azurePreflightLastBody = "<no body>";
      }
      console.error("Azure preflight failed", { status: res.status, body: azurePreflightLastBody });
      azurePreflightOk = false;
      return false;
    }

    azurePreflightLastBody = null;
    azurePreflightOk = true;
    return true;
  } catch (e) {
    azurePreflightOk = false;
    azurePreflightLastStatus = -1;
    azurePreflightLastBody = String(e);
    console.error("Azure preflight exception", e);
    return false;
  }
}


async function generateAnalysis(symbol: string, smaVal: number, rsiVal: number, regime: string): Promise<AIResult> {
  const baseSummary = `Regime ${regime}; SMA20 ${smaVal.toFixed(2)}, RSI14 ${rsiVal.toFixed(2)}`;

  if (!azureEndpoint || !azureKey || !azureDeployment) {
    if (REQUIRE_AZURE) throw new Error("Azure required but missing ENDPOINT/API_KEY/DEPLOYMENT");
    return { summary: baseSummary, risks: deriveHeuristicRisk(rsiVal, regime), ai_source: "heuristic", ai_fallback_used: "heuristic", ai_echo_validated: false };
  }

  const echo = {
    symbol,
    regime,
    sma20: Number(smaVal.toFixed(4)),
    rsi14: Number(rsiVal.toFixed(4)),
  };
  const inputHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(echo)));
  const inputHashHex = Array.from(new Uint8Array(inputHashBuf)).map((n) => n.toString(16).padStart(2, "0")).join("");

  const system = {
    role: "system",
    content:
      "You are a cautious investment research assistant. " +
      "You MUST copy the provided 'echo' object and 'input_hash' EXACTLY, without modification. " +
      "Return only strict JSON. No prose, no markdown.",
  };

  const user = {
    role: "user",
    content:
      `Return JSON matching the schema (no extra fields).\n` +
      `Use these values WITHOUT CHANGING THEM:\n` +
      `echo: ${JSON.stringify(echo)}\n` +
      `input_hash: ${inputHashHex}\n` +
      `Return a concise "summary" and 1–6 short "risks".`,
  };

  const url = `${azureEndpoint}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;

  // Azure-only body: omit temperature/top_p/seed
  const baseBody = {
    messages: [system, user],
    max_completion_tokens: 200,
  };

  const schemaRF = {
    type: "json_schema",
    json_schema: {
      name: "summary_and_risks",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          echo: {
            type: "object",
            additionalProperties: false,
            properties: {
              symbol: { type: "string" },
              regime: { type: "string" },
              sma20: { type: "number" },
              rsi14: { type: "number" },
            },
            required: ["symbol", "regime", "sma20", "rsi14"],
          },
          input_hash: { type: "string" },
          summary: { type: "string", minLength: 1, maxLength: 280 },
          risks: {
            type: "array",
            items: { type: "string", minLength: 3, maxLength: 80 },
            minItems: 1,
            maxItems: 6,
          },
          error: { type: "string" },
        },
        required: ["echo", "input_hash", "summary", "risks"],
      },
    },
  } as const;

  const headers = { "content-type": "application/json", "api-key": azureKey! };

  async function doCall(response_format: any) {
    return await callWithRetry(
      () =>
        fetchWithTimeout(
          url,
          { method: "POST", headers, body: JSON.stringify({ ...baseBody, response_format }) },
          15000
        ),
      3
    );
  }

  try {
    let usedFallback: "json_object" | "heuristic" | null = null;
    let res = await doCall(schemaRF);

    // Fallback for deployments that don't support json_schema (400 or 415)
    if (res.status === 400 || res.status === 415) {
      usedFallback = "json_object";
      res = await doCall({ type: "json_object" });
    }

    if (!res.ok) {
      const text = await res.text();
      console.error("Azure OpenAI error", res.status, text);
      if (REQUIRE_AZURE) throw new Error(`Azure OpenAI error ${res.status}`);
      return { summary: baseSummary, risks: deriveHeuristicRisk(rsiVal, regime), ai_source: "heuristic", ai_fallback_used: "heuristic", ai_echo_validated: false };
    }

    const azureRequestId = res.headers.get("x-request-id") ?? res.headers.get("apim-request-id");
    const rateLimitRem = res.headers.get("x-ratelimit-remaining-tokens");
    const latencyMs = Number(res.headers.get("x-processing-ms") ?? "0") || undefined;

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      if (REQUIRE_AZURE) throw new Error("Azure returned empty content");
      return { summary: baseSummary, risks: deriveHeuristicRisk(rsiVal, regime), ai_source: "heuristic", ai_fallback_used: "heuristic", ai_echo_validated: false };
    }

    // -------- Hardened parsing & validation ----------
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      if (REQUIRE_AZURE) throw new Error("Azure returned non-JSON content");
      return { summary: baseSummary, risks: deriveHeuristicRisk(rsiVal, regime), ai_source: "heuristic", ai_fallback_used: "heuristic", ai_echo_validated: false };
    }

    const toNum = (x: any) => (typeof x === "number" ? x : Number(x));
    const normHash = (x: any) => String(x ?? "").trim().toLowerCase();

    const e = parsed?.echo ?? {};
    const echoCoerced = {
      symbol: String(e.symbol ?? ""),
      regime: String(e.regime ?? ""),
      sma20: toNum(e.sma20),
      rsi14: toNum(e.rsi14),
    };

    if (!echoCoerced.symbol || !echoCoerced.regime || !Number.isFinite(echoCoerced.sma20) || !Number.isFinite(echoCoerced.rsi14)) {
      throw new Error("Echo missing required fields");
    }

    const EPS = 1e-4; // more forgiving tolerance
    const hashFromModel = normHash(parsed.input_hash);
    const expectedHash = normHash(inputHashHex);

    if (hashFromModel !== expectedHash) throw new Error("Echo/hash mismatch");
    if (echoCoerced.symbol !== symbol || echoCoerced.regime !== regime) throw new Error("Echo fields mismatch");
    if (!nearlyEqual(echoCoerced.sma20, echo.sma20, EPS) || !nearlyEqual(echoCoerced.rsi14, echo.rsi14, EPS)) {
      throw new Error("Echo numbers mismatch");
    }

    const risksOut: string =
      Array.isArray(parsed.risks)
        ? parsed.risks.filter((s: any) => typeof s === "string" && s.trim()).join("; ")
        : String(parsed.risks ?? "");

    // Optional: consider schema-guaranteed success
    const schemaGuaranteed = (usedFallback === null);

    return {
      summary: String(parsed.summary ?? baseSummary),
      risks: risksOut || deriveHeuristicRisk(rsiVal, regime),
      ai_source: "azure",
      ai_request_id: json?.id ?? azureRequestId,
      ai_latency_ms: latencyMs,
      ai_ratelimit_remaining_tokens: rateLimitRem,
      ai_echo_validated: schemaGuaranteed ? true : true, // we passed checks above; keep true
      ai_fallback_used: usedFallback,
    };
  } catch (e) {
    console.error("generateAnalysis verification failed", e);
    if (REQUIRE_AZURE) throw e;
    return { summary: baseSummary, risks: deriveHeuristicRisk(rsiVal, regime), ai_source: "heuristic", ai_fallback_used: "heuristic", ai_echo_validated: false };
  }
}

/* --------------------------------- serve --------------------------------- */

Deno.serve(async (req) => {
  const runId = crypto.randomUUID();
  const startTs = Date.now();

  try {
    const { searchParams } = new URL(req.url);
    const timeframe = coerceTimeframe(searchParams.get("timeframe"));
    const alpacaTF = mapToAlpacaTimeframe(timeframe);
    const modelId = searchParams.get("model_id") ?? undefined;
    const modelVersion = searchParams.get("model_version") ?? undefined;
    const symbols = parseSymbols(searchParams.get("symbols"));

    const azureRequired = (searchParams.get("azure_required") ?? "").trim() === "1" || REQUIRE_AZURE;

    const url = requireEnv("SUPABASE_URL");
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(url, key);

    console.log("research-run start", { runId, timeframe, alpacaTF, symbols, modelId, modelVersion, azureRequired });

    // Optional health check mode
    if ((searchParams.get("preflight") ?? "") === "1") {
      const preflightOk = await azurePreflight();
      const body = {
        ok: preflightOk,
        azure: {
          reachable: preflightOk,
          api_version: azureApiVersion,
          status: azurePreflightLastStatus,
          message: azurePreflightLastBody, // shows 401/403/404/429 reasons
          endpoint: azureEndpoint,
          deployment: azureDeployment,
        },
      };
      return new Response(JSON.stringify(body), {
        status: preflightOk ? 200 : 502,
        headers: { "content-type": "application/json", "x-run-id": runId },
      });
    }

    // Azure preflight if required
    const preflightOk = await azurePreflight();
    if (azureRequired && !preflightOk) {
      const detail = {
        ok: false,
        error: "Azure OpenAI unreachable (preflight failed)",
        status: azurePreflightLastStatus,
        message: azurePreflightLastBody,
        endpoint: azureEndpoint,
        deployment: azureDeployment,
        api_version: azureApiVersion,
      };
      return new Response(JSON.stringify(detail), {
        status: 502,
        headers: { "content-type": "application/json", "x-run-id": runId },
      });
    }


    const results: Array<{ symbol: string; id: number; ai_source: "azure" | "heuristic"; ai_request_id?: string | null }> = [];
    const errors: string[] = [];
    let anyHeuristic = false;

    await Promise.all(
      symbols.map(async (symbol) => {
        const symbolStart = Date.now();
        try {
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "RESEARCH_RUN",
            entity_type: "research",
            payload_json: { run_id: runId, symbol, timeframe, model_id: modelId, model_version: modelVersion },
          });

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

          const grossEdge = Math.max(0, last.h - last.c);
          const txCost = transactionCost(qty, commission);
          const slip = slippage(last.c, qty, slippageBps);
          const net = netEdge(grossEdge, last.c, qty, commission, slippageBps);
          const expectedReturn = last.c > 0 ? net / last.c : 0;
          const confidence = grossEdge < 1e-9 ? 0 : Math.max(0, Math.min(1, net / (grossEdge || 1)));

          const ai = await generateAnalysis(symbol, sma20, rsi14, regime);
          if (azureRequired && ai.ai_source !== "azure") {
            throw new Error("Azure required but AI result is heuristic");
          }
          if (ai.ai_source !== "azure") anyHeuristic = true;

          const { data, error } = await supabase
            .from("trade_opportunities")
            .insert({
              symbol,
              side: "LONG",
              timeframe: timeframe.toLowerCase(),
              entry_plan_json: { price: last.c, transaction_cost: txCost, slippage: slip, net_edge: net },
              stop_plan_json: { stop: last.l },
              take_profit_json: { tp: last.h },
              risk_summary: `RSI ${rsi14.toFixed(2)}`,
              expected_return: expectedReturn,
              confidence,
              ai_summary: ai.summary,
              ai_risks: ai.risks,
              ai_source: ai.ai_source,
              ai_request_id: ai.ai_request_id ?? null,
              ai_latency_ms: ai.ai_latency_ms ?? null,
              ai_echo_validated: ai.ai_echo_validated ?? null,
              model_id: modelId,
              model_version: modelVersion,
            })
            .select("id")
            .single();

          if (error) throw error;

          results.push({ symbol, id: data!.id, ai_source: ai.ai_source, ai_request_id: ai.ai_request_id });

          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "OPPORTUNITY_CREATED",
            entity_type: "trade_opportunity",
            entity_id: data!.id,
            payload_json: {
              run_id: runId,
              symbol,
              timeframe,
              model_id: modelId,
              model_version: modelVersion,
              ai_source: ai.ai_source,
              ai_request_id: ai.ai_request_id ?? null,
              ai_latency_ms: ai.ai_latency_ms ?? null,
              ai_echo_validated: ai.ai_echo_validated ?? null,
            },
          });

          console.log("symbol done", symbol, { ms: Date.now() - symbolStart });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${symbol}: ${msg}`);
          console.error("research-run failed for", symbol, e);
        }
      })
    );

    if (errors.length) {
      throw new Error(`research-run errors: ${errors.join("; ")}`);
    }

    const respHeaders: Record<string, string> = {
      "content-type": "application/json",
      "x-run-id": runId,
      "x-azure-preflight": String(azurePreflightOk),
      "x-ai-source": anyHeuristic ? "mixed" : "azure",
      "x-runtime-ms": String(Date.now() - startTs),
    };

    return new Response(JSON.stringify({ ok: true, opportunities: results }), { headers: respHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("research-run fatal error", { runId, error: msg });
    return new Response(JSON.stringify({ ok: false, error: msg, run_id: runId }), {
      status: 500,
      headers: { "content-type": "application/json", "x-run-id": runId },
    });
  }
});
