import "server-only";
import https from "node:https";

export const ORANGE_MODE: Record<string, string> = {
  SN: "orange-money-senegal",
  CI: "orange-money-ci",
  ML: "orange-money-mali",
  BF: "orange-money-burkina",
};

export const PHONE_RULES: Record<string, RegExp> = {
  SN: /^(77|78|76|70|75)\d{7}$/,
  CI: /^(07|05|01)\d{8}$/,
  ML: /^(7|8|9)\d{7}$/,
  BF: /^(07|57|67|77)\d{6}$/,
};

export const COUNTRY_NAMES: Record<string, { name: string; flag: string; placeholder: string; example: string }> = {
  SN: { name: "Sénégal", flag: "🇸🇳", placeholder: "77 123 45 67", example: "9 chiffres (ex: 77...)" },
  CI: { name: "Côte d'Ivoire", flag: "🇨🇮", placeholder: "07 12 34 56 78", example: "10 chiffres (ex: 07...)" },
  ML: { name: "Mali", flag: "🇲🇱", placeholder: "70 12 34 56", example: "8 chiffres (ex: 70...)" },
  BF: { name: "Burkina Faso", flag: "🇧🇫", placeholder: "70 12 34 56", example: "8 chiffres (ex: 70...)" },
};

function getBaseUrl(): string {
  const custom = process.env.PAYDUNYA_BASE_URL?.trim();
  if (custom) return custom.replace(/\/+$/, "");
  return "https://app.paydunya.com";
}

function maskSecret(val: string): string {
  if (!val) return "(non configuré)";
  const trimmed = val.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": (process.env.PAYDUNYA_MASTER_KEY || "").trim(),
    "PAYDUNYA-PRIVATE-KEY": (process.env.PAYDUNYA_PRIVATE_KEY || "").trim(),
    "PAYDUNYA-TOKEN": (process.env.PAYDUNYA_TOKEN || "").trim(),
  };
}

function getMaskedHeaders() {
  return {
    "Content-Type": "application/json",
    "PAYDUNYA-MASTER-KEY": maskSecret(process.env.PAYDUNYA_MASTER_KEY || ""),
    "PAYDUNYA-PRIVATE-KEY": maskSecret(process.env.PAYDUNYA_PRIVATE_KEY || ""),
    "PAYDUNYA-TOKEN": maskSecret(process.env.PAYDUNYA_TOKEN || ""),
  };
}

function checkCredentials() {
  const masterKey = (process.env.PAYDUNYA_MASTER_KEY || "").trim();
  const privateKey = (process.env.PAYDUNYA_PRIVATE_KEY || "").trim();
  const token = (process.env.PAYDUNYA_TOKEN || "").trim();

  if (!masterKey || !privateKey || !token) {
    const missing: string[] = [];
    if (!masterKey) missing.push("PAYDUNYA_MASTER_KEY");
    if (!privateKey) missing.push("PAYDUNYA_PRIVATE_KEY");
    if (!token) missing.push("PAYDUNYA_TOKEN");
    const err = new Error(
      `Identifiants PayDunya manquants dans .env.local : ${missing.join(", ")}`
    );
    console.error("\n" + "=".repeat(60));
    console.error("❌ [PAYDUNYA CONFIGURATION ERROR]", err.message);
    console.error("=".repeat(60) + "\n");
    throw err;
  }
}

interface HttpResult {
  status: number;
  statusText: string;
  body: string;
}

/**
 * Client HTTP natif node:https pour éviter le timeout de 10s d'undici/fetch sur Windows
 */
function httpPost(
  urlStr: string,
  payload: unknown,
  headers: Record<string, string>,
  timeoutMs = 15000
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(payload);

    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode || 200,
          statusText: res.statusMessage || "OK",
          body: data,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout de connexion vers PayDunya (${timeoutMs / 1000}s)`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

interface PayDunyaInvoiceResponse {
  response_code?: string;
  response_text?: string;
  description?: string;
  disburse_token?: string;
  [key: string]: unknown;
}

interface PayDunyaSubmitResponse {
  response_code?: string;
  response_text?: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

export async function disburseOrangeMoney(opts: {
  phone: string;
  amountFcfa: number;
  withdrawMode: string;
  disburseId: string;
}) {
  checkCredentials();

  const base = getBaseUrl();
  const headers = getHeaders();
  const maskedHeaders = getMaskedHeaders();
  const mode = (process.env.PAYDUNYA_MODE || "test").trim().toLowerCase();
  const callbackUrl = `${process.env.APP_URL || "http://localhost:3000"}/api/paydunya/callback`;

  // =========================================================================
  // ÉTAPE 1 : Créer la facture de décaissement (get-invoice)
  // =========================================================================
  const getInvoiceUrl = `${base}/api/v2/disburse/get-invoice`;
  const getInvoicePayload = {
    account_alias: opts.phone,
    amount: opts.amountFcfa,
    withdraw_mode: opts.withdrawMode,
    callback_url: callbackUrl,
  };

  const start1 = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log("📱 [PAYDUNYA API REQUEST: get-invoice] ->", "POST", getInvoiceUrl);
  console.log("Environnement / Mode:", mode);
  console.log("En-têtes sécurisés:", JSON.stringify(maskedHeaders, null, 2));
  console.log("Corps de requête:", JSON.stringify(getInvoicePayload, null, 2));
  console.log("=".repeat(60));

  let res1: HttpResult;
  try {
    res1 = await httpPost(getInvoiceUrl, getInvoicePayload, headers, 15000);
  } catch (netErr: unknown) {
    const elapsed = Date.now() - start1;
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    console.error(`❌ [PAYDUNYA NETWORK ERROR] (en ${elapsed}ms) sur get-invoice:`, msg);
    console.error("URL appelée:", getInvoiceUrl);
    console.log("=".repeat(60) + "\n");
    throw new Error(`Impossible de joindre l'API PayDunya (get-invoice): ${msg}`);
  }

  const elapsed1 = Date.now() - start1;
  let inv: PayDunyaInvoiceResponse;

  try {
    inv = JSON.parse(res1.body);
  } catch {
    console.error("\n" + "=".repeat(60));
    console.error(`❌ [PAYDUNYA INVALID JSON ERROR] HTTP ${res1.status} ${res1.statusText} (en ${elapsed1}ms)`);
    console.error("Réponse brute non-JSON:", res1.body);
    console.error("=".repeat(60) + "\n");
    throw new Error(
      `PayDunya a retourné une réponse non-JSON (HTTP ${res1.status}): ${res1.body.slice(0, 200)}`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📥 [PAYDUNYA API RESPONSE: get-invoice] (HTTP ${res1.status} en ${elapsed1}ms)`);
  console.log("Code Réponse:", inv.response_code ?? "(aucun)");
  console.log("Message:", inv.response_text || inv.description || "(aucun)");
  console.log("Token généré:", inv.disburse_token ? `${inv.disburse_token.slice(0, 10)}...` : "(aucun)");
  console.log("Payload complet:", JSON.stringify(inv, null, 2));
  console.log("=".repeat(60));

  // Vérification d'erreur de l'Étape 1
  if (res1.status !== 200 || inv.response_code !== "00" || !inv.disburse_token) {
    const errMsg =
      inv.response_text ||
      inv.description ||
      `Code d'erreur PayDunya: ${inv.response_code || "inconnu"}`;

    console.error("\n" + "=".repeat(60));
    console.error("❌ [PAYDUNYA DISBURSE ERROR: get-invoice REFUSÉ]");
    console.error("  Code erreur :", inv.response_code);
    console.error("  Explication :", errMsg);
    console.error("  Téléphone   :", opts.phone);
    console.error("  Mode Orange :", opts.withdrawMode);
    console.error("  Montant XOF :", opts.amountFcfa);
    console.error("  Détails     :", JSON.stringify(inv, null, 2));
    console.error("=".repeat(60) + "\n");

    throw new Error(`Échec PayDunya get-invoice [${inv.response_code}]: ${errMsg}`);
  }

  // =========================================================================
  // ÉTAPE 2 : Soumettre le déboursement (submit-invoice)
  // =========================================================================
  const submitUrl = `${base}/api/v2/disburse/submit-invoice`;
  const submitPayload = {
    disburse_invoice: inv.disburse_token,
    disburse_id: opts.disburseId,
  };

  const start2 = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log("📱 [PAYDUNYA API REQUEST: submit-invoice] ->", "POST", submitUrl);
  console.log("En-têtes sécurisés:", JSON.stringify(maskedHeaders, null, 2));
  console.log("Corps de requête:", JSON.stringify(submitPayload, null, 2));
  console.log("=".repeat(60));

  let res2: HttpResult;
  try {
    res2 = await httpPost(submitUrl, submitPayload, headers, 15000);
  } catch (netErr: unknown) {
    const elapsed = Date.now() - start2;
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    console.error(`❌ [PAYDUNYA NETWORK ERROR] (en ${elapsed}ms) sur submit-invoice:`, msg);
    console.error("URL appelée:", submitUrl);
    console.log("=".repeat(60) + "\n");
    throw new Error(`Impossible de joindre l'API PayDunya (submit-invoice): ${msg}`);
  }

  const elapsed2 = Date.now() - start2;
  let sub: PayDunyaSubmitResponse;

  try {
    sub = JSON.parse(res2.body);
  } catch {
    console.error("\n" + "=".repeat(60));
    console.error(`❌ [PAYDUNYA INVALID JSON ERROR] HTTP ${res2.status} ${res2.statusText} (en ${elapsed2}ms)`);
    console.error("Réponse brute non-JSON:", res2.body);
    console.error("=".repeat(60) + "\n");
    throw new Error(
      `PayDunya submit-invoice a retourné une réponse non-JSON (HTTP ${res2.status}): ${res2.body.slice(0, 200)}`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📥 [PAYDUNYA API RESPONSE: submit-invoice] (HTTP ${res2.status} en ${elapsed2}ms)`);
  console.log("Code Réponse:", sub.response_code ?? "(aucun)");
  console.log("Statut:", sub.status ?? "(aucun)");
  console.log("Message:", sub.response_text || sub.description || "(aucun)");
  console.log("Payload complet:", JSON.stringify(sub, null, 2));
  console.log("=".repeat(60) + "\n");

  // Vérification d'erreur de l'Étape 2
  if (res2.status !== 200 || (sub.response_code && sub.response_code !== "00")) {
    const errMsg =
      sub.response_text ||
      sub.description ||
      `Code d'erreur: ${sub.response_code || "inconnu"}`;

    console.error("\n" + "=".repeat(60));
    console.error("❌ [PAYDUNYA DISBURSE ERROR: submit-invoice REFUSÉ]");
    console.error("  Code erreur :", sub.response_code);
    console.error("  Explication :", errMsg);
    console.error("  Invoice     :", inv.disburse_token);
    console.error("  Disburse ID :", opts.disburseId);
    console.error("  Détails     :", JSON.stringify(sub, null, 2));
    console.error("=".repeat(60) + "\n");

    throw new Error(`Échec PayDunya submit-invoice [${sub.response_code}]: ${errMsg}`);
  }

  return {
    token: inv.disburse_token,
    result: sub,
  };
}

export async function checkDisburseStatus(token: string) {
  checkCredentials();
  const base = getBaseUrl();
  const headers = getHeaders();
  const maskedHeaders = getMaskedHeaders();

  const url = `${base}/api/v2/disburse/check-status`;
  const payload = { disburse_token: token };

  const start = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log("🔍 [PAYDUNYA API REQUEST: check-status] ->", "POST", url);
  console.log("En-têtes sécurisés:", JSON.stringify(maskedHeaders, null, 2));
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("=".repeat(60));

  let res: HttpResult;
  try {
    res = await httpPost(url, payload, headers, 15000);
  } catch (netErr: unknown) {
    const elapsed = Date.now() - start;
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    console.error(`❌ [PAYDUNYA NETWORK ERROR] (en ${elapsed}ms) sur check-status:`, msg);
    console.log("=".repeat(60) + "\n");
    throw new Error(`Erreur réseau PayDunya check-status: ${msg}`);
  }

  const elapsed = Date.now() - start;
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(res.body);
  } catch {
    console.error(`❌ [PAYDUNYA INVALID JSON ERROR] (HTTP ${res.status} en ${elapsed}ms):`, res.body);
    throw new Error(`PayDunya check-status non-JSON: ${res.body.slice(0, 200)}`);
  }

  console.log(`📥 [PAYDUNYA API RESPONSE: check-status] (HTTP ${res.status} en ${elapsed}ms)`);
  console.log(JSON.stringify(data, null, 2));
  console.log("=".repeat(60) + "\n");

  return data;
}
