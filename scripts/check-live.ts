// Vérifie ce que le compte autorise en production, SANS déplacer d'argent :
// cotation payout + création d'une facture Lightning de 50 sats (non payée, expire en 2 min).
// Usage : npx tsx scripts/check-live.ts
import { config } from "dotenv";
config({ path: ".env.local" });
const { createInvoice, createPayoutQuote, BitnobError } = await import("../src/lib/bitnob");

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    console.log(`\n✅ ${name}\n${JSON.stringify(await fn(), null, 2).slice(0, 900)}`);
  } catch (e) {
    console.log(`\n❌ ${name}\n${(e as Error).message}\n${e instanceof BitnobError ? JSON.stringify(e.body) : ""}`);
  }
}

await step("Cotation 1000 FCFA (production)",
  () => createPayoutQuote({ settlementAmountFcfa: 1000, reference: `live-check-${Date.now()}` }));
await step("Facture Lightning 50 sats (production, non payée)",
  () => createInvoice({ amountSats: 50, description: "Test de création (ne pas payer)", reference: `live-inv-${Date.now()}`, expirySeconds: 120 }));
