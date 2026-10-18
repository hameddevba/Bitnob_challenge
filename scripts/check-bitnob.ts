// Vérification pas à pas de l'accès Bitnob. Aucun fonds n'est déplacé.
// Usage : npm run check:bitnob
import { config } from "dotenv";
config({ path: ".env.local" });

const { bitnob, createPayoutQuote, BitnobError } = await import("../src/lib/bitnob");

async function step(name: string, fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    console.log(`\n✅ ${name}\n${JSON.stringify(out, null, 2).slice(0, 1500)}`);
    return true;
  } catch (e) {
    const detail = e instanceof BitnobError ? JSON.stringify(e.body).slice(0, 800) : String(e);
    console.log(`\n❌ ${name}\n${(e as Error).message}\n${detail}`);
    return false;
  }
}

const ok = await step("1. Authentification (GET /api/whoami)", () => bitnob("GET", "/api/whoami"));
if (!ok) {
  process.exitCode = 1;
} else {
  await step("2. Soldes (GET /api/balances)", () => bitnob("GET", "/api/balances"));
  await step("3. Sénégal disponible en payout (GET /api/payouts/supported-countries/SN)",
    () => bitnob("GET", "/api/payouts/supported-countries/SN"));
  await step("4. Opérateurs mobile money SN (GET /api/payouts/banks/SN)",
    () => bitnob("GET", "/api/payouts/banks/SN"));
  await step("5. Cotation 1000 FCFA en BTC (POST /api/payouts/quotes)",
    () => createPayoutQuote({ settlementAmountFcfa: 1000, reference: `check-${Date.now()}` }));
}
