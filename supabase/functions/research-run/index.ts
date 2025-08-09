import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (_req) => {
  // TODO: fetch candles, compute signals, call Azure OpenAI for narrative,
  // write trade_opportunities + research reports
  return new Response(JSON.stringify({ ok: true, message: "research-run stub" }), {
    headers: { "content-type": "application/json" },
  });
});
