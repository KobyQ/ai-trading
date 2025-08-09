import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (_req) => {
  // TODO: per-minute monitor of OPEN trades: stops, trailing adjustments, approvals TTL
  return new Response(JSON.stringify({ ok: true, message: "monitor-open-trades stub" }), {
    headers: { "content-type": "application/json" },
  });
});
