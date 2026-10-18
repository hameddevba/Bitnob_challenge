import { describe, expect, it, vi } from "vitest";
import {
  invoiceAmountSats, invoiceForAddress, lightningAddressUrl, maxRoutingFee, refundAmount,
} from "@/lib/refunds";

// Vraie facture sandbox Bitnob de 5000 sats (lntb50u = 50 µBTC)
const PR_5000 = "lntb50u1p4dgnenpp5kdf6umldzjgeuzlljdxprvyd3cmy8kehww80y6vy20a7ayt4e97sdpzg4h8vmmfypmx2unnypshwcfq9pmkzan99ycqzpgxqzftsp56dl2yshzlavvzezczw57u9r8l0x4l42wwu3rqwxgjcqv8hxjg52s9qrsgqwsyxpjgla0ddevmuw2m35jn8kg7w66jw63272mqngjkequf8kjwsrpkalyum2423cu0uxsv9u032ezfga0ekl8h95p96m0r9w8vr6dgqsk9d93";

describe("montant remboursé", () => {
  it("déduit les frais de routage plafonnés (1 %, minimum 10 sats)", () => {
    expect(maxRoutingFee(500)).toBe(10);
    expect(maxRoutingFee(10_448)).toBe(105);
    expect(refundAmount(10_448)).toBe(10_343);
  });
});

describe("résolution d'adresse Lightning (anti-SSRF)", () => {
  it("construit l'URL LUD-16 en HTTPS", () => {
    expect(lightningAddressUrl("Moussa@Blink.sv").toString()).toBe("https://blink.sv/.well-known/lnurlp/moussa");
  });
  it("refuse localhost, IP, domaines internes et formats invalides", () => {
    for (const a of ["a@localhost", "a@127.0.0.1", "a@box.local", "a@svc.internal", "pas-une-adresse", "a@x"]) {
      expect(() => lightningAddressUrl(a)).toThrow();
    }
  });
});

describe("décodage de facture", () => {
  it("lit le montant d'une facture BOLT11", () => {
    expect(invoiceAmountSats(PR_5000).sats).toBe(5000);
  });
});

describe("invoiceForAddress", () => {
  const meta = { tag: "payRequest", callback: "https://blink.sv/lnurlp/cb", minSendable: 1000, maxSendable: 100_000_000 };
  const { expiresAt } = invoiceAmountSats(PR_5000);
  const validNow = expiresAt - 60_000;

  function mockFetch(cbResponse: unknown, metaResponse: unknown = meta) {
    return vi.fn(async (url: URL | string) => {
      const u = new URL(url.toString());
      const body = u.pathname.startsWith("/.well-known/") ? metaResponse : cbResponse;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("renvoie la facture quand le montant correspond exactement", async () => {
    const f = mockFetch({ pr: PR_5000, routes: [] });
    await expect(invoiceForAddress("moussa@blink.sv", 5000, f, validNow)).resolves.toBe(PR_5000);
    const cbCall = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0].toString();
    expect(cbCall).toContain("amount=5000000");
  });
  it("refuse de payer une facture d'un autre montant", async () => {
    await expect(invoiceForAddress("moussa@blink.sv", 4999, mockFetch({ pr: PR_5000 }), validNow)).rejects.toThrow(/au lieu de/);
  });
  it("refuse une facture expirée", async () => {
    await expect(invoiceForAddress("moussa@blink.sv", 5000, mockFetch({ pr: PR_5000 }), expiresAt + 1)).rejects.toThrow(/expirée/);
  });
  it("remonte l'erreur du portefeuille et les montants hors limites", async () => {
    await expect(invoiceForAddress("moussa@blink.sv", 5000, mockFetch({ status: "ERROR", reason: "Compte bloqué" }), validNow)).rejects.toThrow("Compte bloqué");
    await expect(invoiceForAddress("moussa@blink.sv", 5000, mockFetch({}, { ...meta, maxSendable: 1_000_000 }), validNow)).rejects.toThrow(/hors limites/);
  });
  it("refuse une adresse qui n'est pas un payRequest ou un callback non HTTPS", async () => {
    await expect(invoiceForAddress("moussa@blink.sv", 5000, mockFetch({}, { tag: "withdrawRequest" }), validNow)).rejects.toThrow(/compatible/);
    await expect(invoiceForAddress("moussa@blink.sv", 5000, mockFetch({ pr: PR_5000 }, { ...meta, callback: "http://blink.sv/cb" }), validNow)).rejects.toThrow(/HTTPS/);
  });
});
