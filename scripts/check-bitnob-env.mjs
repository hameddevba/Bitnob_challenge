
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function loadEnvFile(path) {
  let content;

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    process.env[key] ??= value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const baseUrl =
  process.env.BITNOB_BASE_URL || "https://api.bitnob.com";

const clientId = process.env.BITNOB_CLIENT_ID;
const clientSecret = process.env.BITNOB_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Identifiants Bitnob absents de .env.local ou .env");
  process.exit(1);
}

const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = randomUUID().replaceAll("-", "");
const message = `${clientId}:${timestamp}:${nonce}:`;

const signature = createHmac("sha256", clientSecret)
  .update(message)
  .digest("hex");

try {
  const response = await fetch(`${baseUrl}/api/whoami`, {
    method: "GET",
    headers: {
      "X-Auth-Client": clientId,
      "X-Auth-Timestamp": timestamp,
      "X-Auth-Nonce": nonce,
      "X-Auth-Signature": signature,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  const result = await response.json();

  console.log("Statut HTTP :", response.status);
  console.log("Champs reçus :", Object.keys(result));
  console.log("Réponse Bitnob :", JSON.stringify(result, null, 2));
  console.log("Environnement :", result.data?.environment ?? "non indiqué");

  if (!response.ok) {
    console.log("Message :", result.message ?? result.error ?? "Erreur API");
  }
} catch (error) {
  console.error(
    "Échec de la requête :",
    error instanceof Error ? error.message : "Erreur inconnue",
  );
}
