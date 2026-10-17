import { describe, expect, it } from "vitest";
import { createTransferSchema, maskPhone, normalizeSnPhone } from "@/lib/validators";
import { invoiceExpirySeconds } from "@/lib/transfers";

const valid = {
  amountFcfa: 2000, recipientName: "Awa Diop", recipientPhone: "77 123 45 67",
  senderName: "Moussa Dione", senderCountry: "fr",
};

describe("numéros sénégalais", () => {
  it("normalise les formats courants en 9 chiffres", () => {
    expect(normalizeSnPhone("77 123 45 67")).toBe("771234567");
    expect(normalizeSnPhone("+221 77 123 45 67")).toBe("771234567");
    expect(normalizeSnPhone("221771234567")).toBe("771234567");
  });
  it("refuse les numéros invalides", () => {
    expect(() => normalizeSnPhone("33 123 45 67")).toThrow();
    expect(() => normalizeSnPhone("7712345")).toThrow();
  });
  it("masque le numéro", () => {
    expect(maskPhone("771234567")).toBe("77 ••• •• 67");
  });
});

describe("createTransferSchema", () => {
  it("accepte un transfert valide, réseau Orange par défaut", () => {
    const r = createTransferSchema.parse(valid);
    expect(r.recipientPhone).toBe("771234567");
    expect(r.recipientNetwork).toBe("orange");
    expect(r.senderCountry).toBe("FR");
  });
  it("refuse un réseau inconnu, un montant hors limites, un nom vide", () => {
    expect(createTransferSchema.safeParse({ ...valid, recipientNetwork: "mtn" }).success).toBe(false);
    expect(createTransferSchema.safeParse({ ...valid, amountFcfa: 10 }).success).toBe(false);
    expect(createTransferSchema.safeParse({ ...valid, recipientName: " " }).success).toBe(false);
  });
});

describe("expiration de la facture", () => {
  const now = Date.parse("2026-10-17T22:53:15Z");
  it("expire 60 s avant la cotation", () => {
    expect(invoiceExpirySeconds("2026-10-17T22:59:15Z", now)).toBe(300);
  });
  it("jamais moins de 60 s", () => {
    expect(invoiceExpirySeconds("2026-10-17T22:53:30Z", now)).toBe(60);
  });
});
