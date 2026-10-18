
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
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );

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

const baseUrl = (
  process.env.BITNOB_BASE_URL || "https://api.bitnob.com"
).replace(/\/+$/, "");

const clientId = process.env.BITNOB_CLIENT_ID;
const clientSecret = process.env.BITNOB_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Identifiants Bitnob absents.");
  process.exit(1);
}

const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce = randomUUID();

// Pour cette requête GET, le corps est vide.
const payload = `${clientId}:${timestamp}:${nonce}:`;

const signature = createHmac("sha256", clientSecret)
  .update(payload)
  .digest("hex");

try {
  const response = await fetch(`${baseUrl}/api/balances/BTC`, {
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

  const result = await response.json().catch(() => null);

  console.log("Statut HTTP :", response.status);
  console.log("Succès :", result?.success ?? false);
  console.log("Message :", result?.message ?? "Aucun message");

    if (!response.ok || result?.success !== true) {
    console.log("Détail de l'erreur :", JSON.stringify(result));
    process.exit(1);
  }

  // Affiche les données de solde retournées par Bitnob.
  // Aucun retrait n'est effectué.
  console.log(
    "Informations du solde BTC :",
    JSON.stringify(result.data ?? null, null, 2)
  );
} catch (error) {
  console.error(
    "Échec de la consultation :",
    error instanceof Error ? error.message : "Erreur inconnue"
  );
  process.exitCode = 1;
}
