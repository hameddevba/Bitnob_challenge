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

const clientId = process.env.BITNOB_CLIENT_ID;
const clientSecret = process.env.BITNOB_CLIENT_SECRET;
const baseUrl = (
  process.env.BITNOB_BASE_URL || "https://api.bitnob.com"
).replace(/\/+$/, "");

if (!clientId || !clientSecret) {
  console.error("Identifiants Bitnob manquants.");
  process.exit(1);
}

// Ce script refuse d'envoyer une requête si l'environnement
// n'est pas explicitement configuré comme sandbox.
if (process.env.BITNOB_ENV !== "sandbox") {
  console.error(
    "Test bloqué : définis BITNOB_ENV=sandbox dans .env.local."
  );
  process.exit(1);
}

// Aucun retrait réel ne doit être déclenché par inadvertance.
// Vérification uniquement : on prépare et affiche la requête.
const withdrawalBody = {
  to_address: "ADRESSE_BITCOIN_DE_TEST",
  amount: "2089",
  currency: "BTC",
  chain: "bitcoin",
  reference: `BTCBUY_TEST_${randomUUID()}`,
  description: "Test technique SatsCollect sandbox",
};

console.log("Environnement :", process.env.BITNOB_ENV);
console.log("Endpoint prévu :", `${baseUrl}/api/withdrawals`);
console.log("Corps de requête préparé :");
console.log(JSON.stringify(withdrawalBody, null, 2));
console.log(
  "\nAucune requête de retrait n'a été envoyée. " +
  "Remplace l'adresse fictive par une adresse de test valide " +
  "et confirme le mécanisme sandbox avant tout envoi."
);