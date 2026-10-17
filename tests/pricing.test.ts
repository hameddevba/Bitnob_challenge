import { describe, expect, it } from "vitest";
import { btcStringToSats, payoutCostSats, priceFromQuote } from "@/lib/pricing";
import type { Payout } from "@/lib/bitnob";

// Réponse réelle du sandbox (17/10/2026) pour 1000 XOF
const realQuote: Payout = {
  id: "01a14c11-c528-70f9-9fe3-c252c0c88709",
  quote_id: "QT2_21053006",
  status: "QUOTE",
  sat_amount: "2079",
  amount: "0.00002079",
  fees: "0",
  total_amount: "0.00002079",
  settlement_amount: "1000",
  exchange_rate: { rate: "592", btc_rate: "81402.75", currency: "xof" },
  reference: "check",
  expires_at: "2026-10-17T22:59:15.433720662Z",
};

describe("btcStringToSats", () => {
  it("convertit exactement", () => {
    expect(btcStringToSats("0.00002079")).toBe(2079);
    expect(btcStringToSats("1")).toBe(100_000_000);
    expect(btcStringToSats("0.1")).toBe(10_000_000);
  });
  it("arrondit au sat supérieur au-delà de 8 décimales", () => {
    expect(btcStringToSats("0.0000207925940815")).toBe(2080);
    expect(btcStringToSats("0.00002079000")).toBe(2079);
  });
  it("refuse les formats invalides", () => {
    expect(() => btcStringToSats("-1")).toThrow();
    expect(() => btcStringToSats("1e-5")).toThrow();
  });
});

describe("coût du payout", () => {
  it("utilise total_amount quand il existe", () => {
    expect(payoutCostSats(realQuote)).toBe(2079);
  });
  it("sinon additionne amount + fees", () => {
    expect(payoutCostSats({ ...realQuote, total_amount: undefined, fees: "0.00000010" })).toBe(2089);
  });
});

describe("priceFromQuote", () => {
  it("calcule le total à payer avec 1,5 % de frais", () => {
    const p = priceFromQuote(realQuote, 1000, 1.5);
    expect(p.payoutCostSats).toBe(2079);
    expect(p.feeSats).toBe(32); // ceil(2079 × 1,5 %) = ceil(31,185)
    expect(p.totalSats).toBe(2111);
    expect(p.feeFcfa).toBe(16);
    expect(p.totalSats).toBeGreaterThanOrEqual(p.payoutCostSats); // jamais à perte
  });
  it("refuse une cotation pour un autre montant", () => {
    expect(() => priceFromQuote(realQuote, 2000, 1.5)).toThrow(/incohérente/);
  });
});
