import { SecretClient } from "npm:@azure/keyvault-secrets";
import { DefaultAzureCredential } from "npm:@azure/identity";

export const cron = "0 0 1 */3 *"; // run quarterly

Deno.serve(async () => {
  const url = Deno.env.get("AZURE_KEY_VAULT_URL");
  if (!url) return new Response("missing vault url", { status: 500 });
  const keyName = Deno.env.get("BROKER_KEY_NAME") || "broker-key";
  const secretName = Deno.env.get("BROKER_SECRET_NAME") || "broker-secret";
  const client = new SecretClient(url, new DefaultAzureCredential());
  await client.setSecret(keyName, crypto.randomUUID());
  await client.setSecret(secretName, crypto.randomUUID());
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
});
