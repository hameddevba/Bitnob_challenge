import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { netSatsFromTotal, priceFromSatsQuote, satsToBtcString } from "@/lib/pricing";
import { verifyLightningProof } from "@/lib/proof";
import { handleSchema } from "@/lib/validators";
import type { Payout } from "@/lib/bitnob";

describe("satsToBtcString", () => {
  it("formate sans flottants", () => {
    expect(satsToBtcString(4926)).toBe("0.00004926");
    expect(satsToBtcString(100_000_000)).toBe("1.00000000");
    expect(satsToBtcString(1)).toBe("0.00000001");
  });
  it("refuse les valeurs invalides", () => {
    expect(() => satsToBtcString(1.5)).toThrow();
    expect(() => satsToBtcString(-1)).toThrow();
  });
});

describe("adresse Lightning : total fixé par l'expéditeur", () => {
  it("prélève 1,5 % sur le total", () => {
    expect(netSatsFromTotal(5000, 1.5)).toBe(4926); // valeur observée en sandbox
  });

  // Cotation sandbox réelle pour amount = 0.00004926 BTC
  const q = {
    quote_id: "QT2_x", status: "QUOTE", sat_amount: "4926", amount: "0.00004926", fees: "0",
    total_amount: "0.00004926", settlement_amount: "2401.84", exchange_rate: { rate: "592", btc_rate: "81000", currency: "xof" },
    reference: "r", expires_at: "2026-10-18T00:00:00Z", id: "x",
  } as Payout;

  it("arrondit le FCFA à l'unité inférieure et garde la marge", () => {
    const p = priceFromSatsQuote(q, 5000);
    expect(p.amountFcfa).toBe(2401);
    expect(p.payoutCostSats).toBe(4926);
    expect(p.feeSats).toBe(74);
    expect(p.totalSats).toBe(5000);
  });
  it("refuse une cotation plus chère que le montant reçu", () => {
    expect(() => priceFromSatsQuote(q, 4000)).toThrow(/plus chère/);
  });
});

describe("identifiants de lien", () => {
  it("accepte et normalise", () => {
    expect(handleSchema.parse("Awa.Diop")).toBe("awa.diop");
    expect(handleSchema.parse("moussa-221")).toBe("moussa-221");
  });
  it("refuse trop court, caractères interdits, mots réservés", () => {
    for (const h of ["ab", ".awa", "awa diop", "awa@x", "api", "creer"]) {
      expect(handleSchema.safeParse(h).success).toBe(false);
    }
  });
});

describe("preuve de paiement Lightning", () => {
  const preimage = randomBytes(32).toString("hex");
  const paymentHash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");

  it("valide une vraie paire preimage / payment_hash", async () => {
    expect(await verifyLightningProof({ preimage, paymentHash })).toBe(true);
    expect(await verifyLightningProof({ preimage, paymentHash: paymentHash.toUpperCase() })).toBe(true);
  });
  it("rejette une preimage modifiée ou un format invalide", async () => {
    const forged = (preimage[0] === "a" ? "b" : "a") + preimage.slice(1);
    expect(await verifyLightningProof({ preimage: forged, paymentHash })).toBe(false);
    expect(await verifyLightningProof({ preimage: "zz", paymentHash })).toBe(false);
  });
});
