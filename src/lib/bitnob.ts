import crypto from "node:crypto";

// Client Bitnob : auth HMAC-SHA256 (docs.codeandchain.xyz → Authentification).
// Chaîne signée : CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD, payload = JSON exact envoyé ('' sans corps).

export class BitnobError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = "BitnobError";
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export function signRequest(
  clientId: string, secret: string, timestamp: string, nonce: string, payload: string,
): string {
  return crypto.createHmac("sha256", secret)
    .update(`${clientId}:${timestamp}:${nonce}:${payload}`)
    .digest("hex");
}

export async function bitnob<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const clientId = env("BITNOB_CLIENT_ID");
  const secret = env("BITNOB_CLIENT_SECRET");
  const base = process.env.BITNOB_BASE_URL || "https://api.bitnob.com";

  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Client": clientId,
      "X-Auth-Timestamp": timestamp,
      "X-Auth-Nonce": nonce,
      "X-Auth-Signature": signRequest(clientId, secret, timestamp, nonce, payload),
    },
    body: payload || undefined, // la chaîne signée, telle quelle
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new BitnobError(res.status, text, `Bitnob ${method} ${path} : réponse non JSON (${res.status})`);
  }
  if (!res.ok || json.success === false) {
    throw new BitnobError(res.status, json, `Bitnob ${method} ${path} : ${json.message ?? res.status}`);
  }
  return json.data as T;
}

// ---------- Lightning ----------

export type LightningInvoice = {
  id: string;
  payment_hash: string;
  request: string; // BOLT11
  amount_sat: string;
  status: "pending" | "paid" | "expired";
  preimage?: string;
  expires_at: string;
};

export function createInvoice(p: {
  amountSats: number; description: string; reference: string; expirySeconds: number;
}) {
  return bitnob<LightningInvoice>("POST", "/api/lightning/invoices", {
    amount: p.amountSats,
    description: p.description,
    expiry: p.expirySeconds,
    reference: p.reference,
  });
}

export function getInvoice(id: string) {
  return bitnob<LightningInvoice>("GET", `/api/lightning/invoices/${encodeURIComponent(id)}`);
}

// ---------- Payouts (BTC → XOF Orange Money) ----------

// Forme observée en sandbox (cotation BTC → XOF, Sénégal) :
// sat_amount "2079", amount "0.00002079", fees "0", total_amount "0.00002079",
// exchange_rate { rate "592" (XOF/USD), btc_rate "81402.75" (USD/BTC) }, expiration ≈ 6 min.
export type Payout = {
  id: string;
  quote_id: string;
  status: string; // QUOTE → INITIATED → PENDING → PROCESSING → COMPLETED / FAILED
  sat_amount: string;
  amount: string;        // BTC
  fees: string;          // en from_asset (BTC)
  total_amount?: string; // BTC débité = amount + fees
  settlement_amount: string;
  exchange_rate: { rate: string; btc_rate: string; currency: string; effective_rate?: string };
  reference: string;
  expires_at: string;
};

// Réseaux mobile money acceptés au Sénégal (GET /api/payouts/supported-countries/SN)
export const SN_NETWORKS = ["orange", "free", "expresso", "wave"] as const;
export type SnNetwork = (typeof SN_NETWORKS)[number];
export const SN_PHONE_PATTERN = /^(\+?221[7]\d{8}|[7]\d{8})$/;

export async function createPayoutQuote(p: {
  settlementAmountFcfa: number; reference: string; country?: string;
}) {
  const data = await bitnob<{ payout: Payout }>("POST", "/api/payouts/quotes", {
    from_asset: "BTC",
    to_currency: "XOF",
    source: "offchain",
    country: p.country ?? "SN",
    settlement_amount: String(p.settlementAmountFcfa),
    payment_reason: "family_support",
    reference: p.reference,
  });
  return data.payout;
}

// Bénéficiaire mobile money SN : account_name, account_number, network, sender{account_name,country}
export async function initializePayout(quoteId: string, p: {
  reference: string; accountName: string; phone: string; network: SnNetwork;
  senderName: string; senderCountry: string; country?: string; callbackUrl?: string;
}) {
  const data = await bitnob<{ payout: Payout }>("POST", `/api/payouts/${encodeURIComponent(quoteId)}/initialize`, {
    quote_id: quoteId,
    reference: p.reference,
    payment_reason: "family_support",
    callback_url: p.callbackUrl,
    beneficiary: {
      destination_type: "mobile_money",
      country: p.country ?? "SN",
      account_name: p.accountName,
      account_number: p.phone,
      network: p.network,
      sender: { account_name: p.senderName, country: p.senderCountry },
    },
  });
  return data.payout;
}

export async function finalizePayout(quoteId: string) {
  const data = await bitnob<{ payout: Payout }>("POST", `/api/payouts/${encodeURIComponent(quoteId)}/finalize`);
  return data.payout;
}

export async function getPayout(id: string) {
  const data = await bitnob<{ payout: Payout } | Payout>("GET", `/api/payouts/${encodeURIComponent(id)}`);
  return "payout" in data ? data.payout : data;
}

// ---------- Webhooks ----------
// x-bitnob-signature = HMAC-SHA512(payload, BITNOB_WEBHOOK_SECRET) en hex.
// La doc signe JSON.stringify(req.body) : on accepte le corps brut ou sa re-sérialisation.

function safeEqualHex(a: string, b: string) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret?: string) {
  const key = secret ?? process.env.BITNOB_WEBHOOK_SECRET;
  if (!signature || !key) return false;
  const sig = signature.trim().toLowerCase();
  const hmac = (s: string) => crypto.createHmac("sha512", key).update(s).digest("hex");
  if (safeEqualHex(hmac(rawBody), sig)) return true;
  try {
    return safeEqualHex(hmac(JSON.stringify(JSON.parse(rawBody))), sig);
  } catch {
    return false;
  }
}
