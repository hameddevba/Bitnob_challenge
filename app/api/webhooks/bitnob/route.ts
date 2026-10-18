import { verifyBitnobSignature } from "@/lib/server/bitnob";
import { admin } from "@/lib/server/supabase";
import { processPayouts } from "@/lib/server/transfers";


export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-bitnob-signature");

    if (process.env.BITNOB_WEBHOOK_SECRET) {
      const isValid = verifyBitnobSignature(rawBody, signature);
      if (!isValid) {
        return new Response("Invalid signature", { status: 401 });
      }
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.event || event?.type || "";
    const data = event?.data || {};

    console.log("\n" + "=".repeat(60));
    console.log("📥 [BITNOB WEBHOOK RECEIVED]");
    console.log("Event Type:", eventType);
    console.log("Payload:", JSON.stringify(event, null, 2));
    console.log("=".repeat(60) + "\n");

    // Stockage dans webhook_events
    const dedupeKey = String(data?.id || data?.reference || event?.id || `bn-${Date.now()}`);
    await admin.from("webhook_events").insert({
      provider: "bitnob",
      dedupe_key: dedupeKey,
      payload: event,
    });

    // Détection du paiement Lightning
    const isLightningPaid =
      eventType.includes("lightning") ||
      eventType.includes("paid") ||
      data?.status === "paid" ||
      data?.status === "success";

    if (isLightningPaid) {
      const ref = data?.reference;
      const paymentHash = data?.payment_hash || data?.paymentHash || data?.r_hash;
      const invoiceId = data?.invoice_id || data?.id;

      // Retrouver le transfert correspondant
      let query = admin.from("transfers").select("id, status");
      if (ref) query = query.eq("bitnob_reference", ref);
      else if (paymentHash) query = query.eq("payment_hash", paymentHash);
      else if (invoiceId) query = query.eq("bitnob_invoice_id", invoiceId);

      const { data: transfer } = await query.maybeSingle();

      if (transfer && transfer.status === "awaiting_payment") {
        await admin.rpc("transition_transfer", {
          p_id: transfer.id,
          p_from: ["awaiting_payment"],
          p_to: "btc_received",
          p_patch: {
            paid_at: new Date().toISOString(),
            preimage: data?.preimage || null,
          },
          p_note: "Paiement Bitcoin Lightning confirmé par Bitnob",
          p_payload: event,
        });

        // Tenter de déclencher le déboursement sans bloquer la réponse webhook
        processPayouts().catch((err) => console.error("Worker process error after webhook:", err));
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err: unknown) {
    console.error("Erreur webhook Bitnob:", err);
    return new Response("OK", { status: 200 });
  }
}
