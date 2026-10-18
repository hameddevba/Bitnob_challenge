import "server-only";
import crypto from "node:crypto";
import { UserError } from "./services";

function getBaseUrl(): string {
  let raw = (process.env.BITNOB_BASE_URL || "https://api.bitnob.com").trim();
  // Remplacer automatiquement les anciens domaines .co obsolètes
  if (raw.includes("bitnob.co") || raw.includes("sandboxapi")) {
    raw = "https://api.bitnob.com";
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Génère les en-têtes d'authentification HMAC-SHA256 officiels de Bitnob
 */
function getAuthHeaders(payloadStr: string): Record<string, string> {
  const clientId = (process.env.BITNOB_CLIENT_ID || "").trim();
  let clientSecret = (process.env.BITNOB_CLIENT_SECRET || "").trim();
  const secretKey = (process.env.BITNOB_SECRET_KEY || "").trim();

  // Si le secret a été collé dans BITNOB_SECRET_KEY
  if (!clientSecret && secretKey.startsWith("prd:")) {
    clientSecret = secretKey;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // 1. Authentification HMAC-SHA256 officielle (X-Auth-...)
  if (clientId && clientSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString("hex");

    // Format canonique : CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD
    const message = `${clientId}:${timestamp}:${nonce}:${payloadStr}`;
    const signature = crypto
      .createHmac("sha256", clientSecret)
      .update(message)
      .digest("hex");

    headers["X-Auth-Client"] = clientId;
    headers["X-Auth-Timestamp"] = timestamp;
    headers["X-Auth-Nonce"] = nonce;
    headers["X-Auth-Signature"] = signature;
    return headers;
  }

  // 2. Repli Bearer token si une clé secrète v1 est fournie
  if (secretKey && !secretKey.startsWith("prd:")) {
    headers["Authorization"] = `Bearer ${secretKey}`;
    return headers;
  }

  return headers;
}

export interface CreateInvoiceParams {
  amountSats: number;
  description: string;
  reference: string;
  expirySeconds: number;
}

export interface BitnobInvoice {
  id: string;
  payment_hash: string;
  request: string; // bolt11 Lightning invoice string
}

export async function createInvoice(params: CreateInvoiceParams): Promise<BitnobInvoice> {
  const base = getBaseUrl();
  const clientId = (process.env.BITNOB_CLIENT_ID || "").trim();
  const clientSecret = (
    process.env.BITNOB_CLIENT_SECRET ||
    (process.env.BITNOB_SECRET_KEY?.startsWith("prd:") ? process.env.BITNOB_SECRET_KEY : "") ||
    ""
  ).trim();

  if (!clientId || !clientSecret) {
    throw new UserError(
      "Identifiants Bitnob manquants : veuillez renseigner BITNOB_CLIENT_ID et BITNOB_CLIENT_SECRET dans le fichier .env.local."
    );
  }

  const payloadObj = {
    amount: params.amountSats,
    description: params.description,
    reference: params.reference,
    expires_at: params.expirySeconds,
  };

  const bodyStr = JSON.stringify(payloadObj);
  const headers = getAuthHeaders(bodyStr);

  // Endpoint officiel Bitnob Lightning
  const url = `${base}/api/lightning/invoices`;

  // =========================================================================
  // LOG REQUÊTE CÔTÉ SERVEUR
  // =========================================================================
  const startTime = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log("⚡ [BITNOB API REQUEST] ->", "POST", url);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log("Payload:", JSON.stringify(payloadObj, null, 2));
  console.log("=".repeat(60));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
    });
  } catch (netErr: unknown) {
    const elapsed = Date.now() - startTime;
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    console.error(`❌ [BITNOB API NETWORK ERROR] (en ${elapsed}ms):`, msg);
    console.log("=".repeat(60) + "\n");
    throw new UserError(`Impossible de contacter l'API Bitnob (${url}) : ${msg}`);
  }

interface BitnobApiResponse {
  status?: boolean;
  code?: string;
  detail?: string;
  message?: string;
  title?: string;
  data?: {
    id?: string;
    invoice_id?: string;
    payment_hash?: string;
    paymentHash?: string;
    r_hash?: string;
    request?: string;
    bolt11?: string;
    payment_request?: string;
    invoice?: string;
  };
  id?: string;
  invoice_id?: string;
  payment_hash?: string;
  paymentHash?: string;
  r_hash?: string;
  request?: string;
  bolt11?: string;
  payment_request?: string;
  invoice?: string;
}

  const elapsed = Date.now() - startTime;
  const rawText = await res.text();
  let json: BitnobApiResponse = {};
  try {
    json = JSON.parse(rawText) as BitnobApiResponse;
  } catch {
    json = { detail: rawText };
  }

  // =========================================================================
  // LOG RÉPONSE CÔTÉ SERVEUR
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  if (res.ok && json.status !== false && json.code !== "FORBIDDEN" && json.code !== "UNAUTHORIZED") {
    console.log(`✅ [BITNOB API RESPONSE] HTTP ${res.status} (en ${elapsed}ms)`);
  } else {
    console.log(`❌ [BITNOB API ERROR RESPONSE] HTTP ${res.status} (en ${elapsed}ms)`);
  }
  console.log("Response Body:", JSON.stringify(json, null, 2));
  console.log("=".repeat(60) + "\n");

  if (!res.ok || json.status === false || json.code === "FORBIDDEN" || json.code === "UNAUTHORIZED") {
    if (json.detail?.includes("IP address not whitelisted") || json.message?.includes("IP address not whitelisted")) {
      throw new UserError(
        "Adresse IP non autorisée par Bitnob. Veuillez vous connecter sur votre tableau de bord Bitnob (Settings > API) et ajouter votre adresse IP publique dans la section 'IP Whitelist'."
      );
    }

    if (res.status === 401 || json.code === "UNAUTHORIZED") {
      throw new UserError(
        "Authentification Bitnob refusée. Vérifiez que BITNOB_CLIENT_ID et BITNOB_CLIENT_SECRET dans .env.local correspondent à vos clés actives."
      );
    }

    const detailMsg = json.detail || json.message || json.title || JSON.stringify(json);
    throw new UserError(`Erreur API Bitnob (${res.status}) : ${detailMsg}`);
  }

  const data = json.data || json;
  return {
    id: data.id || data.invoice_id || params.reference,
    payment_hash: data.payment_hash || data.paymentHash || data.r_hash || "",
    request: data.request || data.bolt11 || data.payment_request || data.invoice || "",
  };
}

/**
 * Vérification de la signature HMAC du webhook Bitnob
 */
export function verifyBitnobSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.BITNOB_WEBHOOK_SECRET;
  console.log("\n" + "=".repeat(60));
  console.log("🔍 [BITNOB WEBHOOK SIGNATURE CHECK]");
  console.log("Received signature:", signature);
  console.log("Webhook secret configured:", Boolean(secret));

  if (!signature || !secret) {
    console.log("Result: Signature or secret missing -> validation skipped or false");
    console.log("=".repeat(60) + "\n");
    return false;
  }

  try {
    const hash = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const valid = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    console.log("Calculated hash:", hash);
    console.log("Result: Is valid?", valid);
    console.log("=".repeat(60) + "\n");
    return valid;
  } catch (e) {
    console.error("Signature check error:", e);
    console.log("=".repeat(60) + "\n");
    return false;
  }
}
