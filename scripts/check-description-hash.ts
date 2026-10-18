// Vérifie si Bitnob place un description_hash (tag BOLT11 « h ») dans la facture,
// condition imposée par LNURL-pay (LUD-06) aux portefeuilles stricts.
// Usage : npx tsx scripts/check-description-hash.ts   (sandbox : aucun fonds déplacé)
import { createHash } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });
const { bitnob } = await import("../src/lib/bitnob");
const { decode } = await import("light-bolt11-decoder");

const metadata = JSON.stringify([["text/plain", "Test description_hash"]]);
const hash = createHash("sha256").update(metadata).digest("hex");

for (const field of ["description_hash", "descriptionHash"]) {
  try {
    const inv = await bitnob<{ request: string }>("POST", "/api/lightning/invoices", {
      amount: 10, description: metadata, expiry: 120, reference: `dh-${field}-${Date.now()}`, [field]: hash,
    });
    const sections = decode(inv.request).sections as { name: string; value?: unknown }[];
    const h = sections.find((s) => s.name === "description_hash")?.value;
    const d = sections.find((s) => s.name === "description")?.value;
    console.log(`${field}: h=${h ?? "absent"} ${h === hash ? "✅ CORRESPOND" : ""} | d=${d ? "présent" : "absent"}`);
  } catch (e) {
    console.log(`${field}: erreur ${(e as Error).message}`);
  }
}
