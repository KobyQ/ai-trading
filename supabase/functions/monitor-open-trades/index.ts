import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Simple per-minute monitor for open trades.
 *
 * Current implementation checks for trades that have been open for more than
 * 24 hours and closes them with a `TTL` reason. More sophisticated trailing
 * stop adjustments can be added later.
 */
serve(async (_req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  const supabase = createClient(url, key);

  const { data: trades, error } = await supabase
    .from("trades")
    .select("id, opened_at")
    .eq("status", "OPEN");
  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let closed = 0;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const t of trades ?? []) {
    const opened = t.opened_at ? new Date(t.opened_at).getTime() : now;
    if (now - opened > dayMs) {
      const { error: updErr } = await supabase
        .from("trades")
        .update({
          status: "CLOSED",
          close_reason: "TTL",
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (!updErr) closed++;
    }
  }

  return new Response(JSON.stringify({ ok: true, closed }), {
    headers: { "content-type": "application/json" },
  });
});
