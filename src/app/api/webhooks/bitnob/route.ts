import { createHash } from "node:crypto";
import { pool } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/bitnob";
import { confirmPayment, findTransferIdForEvent, logEvent, syncPayout } from "@/lib/transfers";

// Webhooks Bitnob : btc.lightning.received.success, payouts.initialized|processing|withdrawal.success|withdrawal.expired
// Signature x-bitnob-signature (HMAC-SHA512). Le corps ne sert qu'à déclencher :
// chaque action revérifie l'état chez Bitnob (GET facture / GET payout).
export async function POST(req: Request) {
  const raw = await req.text(); // corps BRUT, indispensable pour la signature
  const signature = req.headers.get("x-bitnob-signature");
  const secrets = [process.env.BITNOB_WEBHOOK_SECRET, process.env.BITNOB_CLIENT_SECRET].filter(Boolean) as string[];
  if (!secrets.some((s) => verifyWebhookSignature(raw, signature, s))) {
    console.warn("webhook bitnob : signature invalide");
    return new Response("invalid signature", { status: 401 });
  }

  let evt: { event?: string; event_id?: string; data?: Record<string, unknown> };
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const event = evt.event ?? "unknown";
  const data = evt.data ?? {};

  // Déduplication : Bitnob peut renvoyer le même événement jusqu'à 3 fois
  const externalId = evt.event_id ?? createHash("sha256").update(raw).digest("hex");
  const dup = await pool.query(
    `INSERT INTO webhook_receipts(provider, external_id) VALUES ('bitnob',$1)
     ON CONFLICT DO NOTHING RETURNING id`, [externalId]);
  if (dup.rowCount === 0) return new Response("ok (doublon)", { status: 200 });

  const transferId = await findTransferIdForEvent(data);
  await logEvent(pool, transferId, "bitnob", `webhook:${event}`, evt);

  try {
    if (transferId && event.startsWith("btc.lightning")) {
      await confirmPayment(transferId, "webhook");
    } else if (transferId && event.startsWith("payouts.")) {
      await syncPayout(transferId);
    }
  } catch (e) {
    // On répond 200 quand même : la réconciliation reprendra (cron + polling de la page).
    await logEvent(pool, transferId, "system", "webhook_processing_error", { event, error: (e as Error).message });
  }
  return new Response("ok", { status: 200 });
}
