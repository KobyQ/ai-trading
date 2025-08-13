import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

function getEnv(name: string): string | undefined {
  if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
    return Deno.env.get(name) ?? undefined;
  }
  if (typeof process !== "undefined") {
    return process.env[name];
  }
  return undefined;
}

const vaultUrl = getEnv("AZURE_KEY_VAULT_URL");

if (!vaultUrl) {
  throw new Error("AZURE_KEY_VAULT_URL is not set");
}

const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

export async function getBrokerCredentials() {
  const keyName = getEnv("BROKER_KEY_NAME") || "broker-key";
  const secretName = getEnv("BROKER_SECRET_NAME") || "broker-secret";
  const [key, secret] = await Promise.all([
    client.getSecret(keyName),
    client.getSecret(secretName),
  ]);
  return { key: key.value ?? "", secret: secret.value ?? "" };
}
