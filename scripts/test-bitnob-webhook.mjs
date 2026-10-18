
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.BITNOB_WEBHOOK_SECRET;

if (!secret) {
  console.error("BITNOB_WEBHOOK_SECRET est absent de .env.local");
  process.exit(1);
}

const transactionId = process.env.TEST_TRANSACTION_ID;
const amountSats = process.env.TEST_AMOUNT_SATS;

if (!transactionId || !amountSats) {
  console.error(
    "Ajoute TEST_TRANSACTION_ID et TEST_AMOUNT_SATS à .env.local."
  );
  process.exit(1);
}

if (!/^\d+$/.test(amountSats) || Number(amountSats) <= 0) {
  console.error("TEST_AMOUNT_SATS doit être un entier positif.");
  process.exit(1);
}

const payload = {
  event: "transfer.success",
  event_id: `test_${randomUUID()}`,
  data: {
    reference: `ECO_${transactionId}`,
    chain: "lightning",
    amount: amountSats,
    transaction_id: `test_${randomUUID()}`,
  },
};

const rawBody = JSON.stringify(payload);

const signature = createHmac("sha512", secret)
  .update(rawBody)
  .digest("hex");

const baseUrl = process.env.TEST_WEBHOOK_BASE_URL || "http://localhost:3000";

console.log("Envoi du webhook fictif à", `${baseUrl}/api/webhooks/bitnob`);
console.log("Transaction de test :", transactionId);

try {
  const response = await fetch(`${baseUrl}/api/webhooks/bitnob`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bitnob-signature": signature,
    },
    body: rawBody,
  });

  console.log("HTTP :", response.status);
  console.log("Réponse :", await response.text());
} catch (error) {
  console.error("Impossible de joindre le serveur :", error.message);
}
