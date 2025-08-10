import { createHash } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  actor_type: string;
  actor_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  payload_json?: Record<string, unknown>;
}

function computeHash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export async function insertAuditLog(
  supabase: SupabaseClient,
  entry: AuditEntry,
) {
  const { data: last } = await supabase
    .from("audit_log")
    .select("hash")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? "";
  const hash = computeHash(prevHash + JSON.stringify(entry));

  const { error } = await supabase.from("audit_log").insert({
    ...entry,
    hash,
  });
  if (error) {
    throw new Error(error.message);
  }
  return hash;
}

