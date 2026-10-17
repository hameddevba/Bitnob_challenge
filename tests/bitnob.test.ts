import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bitnob, BitnobError, signRequest, verifyWebhookSignature } from "@/lib/bitnob";

const ID = "client_test";
const SECRET = "secret_test";

beforeEach(() => {
  process.env.BITNOB_CLIENT_ID = ID;
  process.env.BITNOB_CLIENT_SECRET = SECRET;
  process.env.BITNOB_BASE_URL = "https://api.test";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: string) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("signature HMAC des requêtes", () => {
  it("signe CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD en HMAC-SHA256 hex", () => {
    const expected = crypto.createHmac("sha256", SECRET).update(`${ID}:1700000000:abcd:{"a":1}`).digest("hex");
    expect(signRequest(ID, SECRET, "1700000000", "abcd", '{"a":1}')).toBe(expected);
  });

  it("GET : payload vide signé, pas de corps envoyé", async () => {
    const f = mockFetch(200, JSON.stringify({ success: true, data: { ok: 1 } }));
    expect(await bitnob("GET", "/api/whoami")).toEqual({ ok: 1 });
    const [url, init] = f.mock.calls[0];
    const h = init.headers as Record<string, string>;
    expect(url).toBe("https://api.test/api/whoami");
    expect(init.body).toBeUndefined();
    expect(h["X-Auth-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["X-Auth-Timestamp"]).toMatch(/^\d{10}$/);
    expect(h["X-Auth-Signature"]).toBe(signRequest(ID, SECRET, h["X-Auth-Timestamp"], h["X-Auth-Nonce"], ""));
  });

  it("POST : le corps envoyé est exactement la chaîne signée", async () => {
    const f = mockFetch(201, JSON.stringify({ success: true, data: {} }));
    await bitnob("POST", "/api/lightning/invoices", { amount: 10, description: "x" });
    const init = f.mock.calls[0][1];
    const h = init.headers as Record<string, string>;
    expect(init.body).toBe('{"amount":10,"description":"x"}');
    expect(h["X-Auth-Signature"]).toBe(signRequest(ID, SECRET, h["X-Auth-Timestamp"], h["X-Auth-Nonce"], init.body as string));
  });

  it("lève BitnobError sur réponse HTTP en erreur", async () => {
    mockFetch(401, JSON.stringify({ success: false, message: "Unauthorized" }));
    await expect(bitnob("GET", "/api/whoami")).rejects.toBeInstanceOf(BitnobError);
  });

  it("lève BitnobError lisible sur réponse non JSON (ex. page HTML 500)", async () => {
    mockFetch(500, "<html>500</html>");
    await expect(bitnob("GET", "/api/whoami")).rejects.toThrow(/non JSON/);
  });

  it("refuse de partir sans clés", async () => {
    delete process.env.BITNOB_CLIENT_SECRET;
    await expect(bitnob("GET", "/api/whoami")).rejects.toThrow(/BITNOB_CLIENT_SECRET/);
  });
});

describe("signature des webhooks", () => {
  const WH = "wh_secret";
  const body = JSON.stringify({ event: "btc.lightning.received.success", event_id: "e1", data: { id: "x" } });
  const sign = (s: string) => crypto.createHmac("sha512", WH).update(s).digest("hex");

  it("accepte une signature valide", () => {
    expect(verifyWebhookSignature(body, sign(body), WH)).toBe(true);
  });
  it("accepte la signature du JSON re-sérialisé (format de la doc)", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhookSignature(pretty, sign(body), WH)).toBe(true);
  });
  it("refuse une signature fausse, absente ou de mauvaise longueur", () => {
    expect(verifyWebhookSignature(body, sign(body + "x"), WH)).toBe(false);
    expect(verifyWebhookSignature(body, null, WH)).toBe(false);
    expect(verifyWebhookSignature(body, "abc", WH)).toBe(false);
  });
  it("refuse un corps modifié", () => {
    expect(verifyWebhookSignature(body.replace("x", "y"), sign(body), WH)).toBe(false);
  });
});
