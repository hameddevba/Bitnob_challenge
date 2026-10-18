import { describe as suite, expect, it } from "vitest";
import { describe, sanitize } from "@/lib/journal";

suite("journal : masquage", () => {
  it("masque les numéros de compte et de téléphone, y compris imbriqués", () => {
    const out = JSON.stringify(sanitize({
      beneficiary: { account_number: "221771234567", network: "wave" },
      note: "appel au 771234567 ou +221771234567",
      sats: 2079,
    }));
    expect(out).not.toMatch(/771234567|1234567/);
    expect(out).toContain("2079"); // les montants restent lisibles
  });
});

suite("journal : libellés", () => {
  it("rend les événements lisibles", () => {
    expect(describe("payment_confirmed", "bitnob", null).tone).toBe("ok");
    expect(describe("webhook:btc.lightning.received.success", "bitnob", null).title).toContain("Webhook Bitnob");
    expect(describe("payout_error", "bitnob", { body: { code: "INSUFFICIENT_FUNDS" } }).detail).toBe("INSUFFICIENT_FUNDS");
  });
});
