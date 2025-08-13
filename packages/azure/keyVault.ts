import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const vaultUrl = Deno.env.get("AZURE_KEY_VAULT_URL");
if (!vaultUrl) {
  throw new Error("AZURE_KEY_VAULT_URL is not set");
}

const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

export async function getBrokerCredentials() {
  const keyName = Deno.env.get("BROKER_KEY_NAME") || "broker-key";
  const secretName = Deno.env.get("BROKER_SECRET_NAME") || "broker-secret";
  const [key, secret] = await Promise.all([
    client.getSecret(keyName),
    client.getSecret(secretName),
  ]);
  return { key: key.value ?? "", secret: secret.value ?? "" };
}
