import { admin } from "@/lib/server/supabase";

export async function POST(req: Request) {
  try {
    const rawText = await req.text();
    let payload: Record<string, unknown> = {};

    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = {};
    }

    console.log("\n" + "=".repeat(60));
    console.log("📥 [PAYDUNYA CALLBACK / WEBHOOK REÇU]");
    console.log("Timestamp :", new Date().toISOString());
    console.log("En-têtes  :", JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
    console.log("Payload   :", JSON.stringify(payload, null, 2));
    console.log("=".repeat(60));

    const dedupeKey =
      String(
        payload?.token ||
        payload?.disburse_token ||
        payload?.transaction_id ||
        payload?.disburse_id ||
        `pd-${Date.now()}`
      );

    // 1. Enregistrement / dédoublonnage de l'événement webhook
    const { error: insErr } = await admin.from("webhook_events").insert({
      provider: "paydunya",
      dedupe_key: dedupeKey,
      payload,
    });

    if (insErr) {
      console.warn("⚠️ [PAYDUNYA CALLBACK DEDUPE/INSERT]:", insErr.message);
    }

    // 2. Traitement du statut
    const token = (payload?.token || payload?.disburse_token) as string | undefined;
    const status = String(payload?.status || "").toLowerCase();

    if (token) {
      const { data: transfer, error: fetchErr } = await admin
        .from("transfers")
        .select("id, status, recipient_phone, amount_xof")
        .eq("disburse_token", token)
        .maybeSingle();

      if (fetchErr) {
        console.error("❌ [PAYDUNYA CALLBACK] Erreur recherche transfert:", fetchErr.message);
      }

      if (transfer) {
        if (status === "completed" || status === "success") {
          console.log(`✅ [PAYDUNYA CALLBACK SUCCESS] Décaissement réussi pour transfert ${transfer.id} (${transfer.recipient_phone})`);
          await admin.rpc("transition_transfer", {
            p_id: transfer.id,
            p_from: ["payout_created", "payout_pending"],
            p_to: "completed",
            p_patch: {
              completed_at: new Date().toISOString(),
              disburse_status: "success",
              paydunya_tx_id: payload?.transaction_id || null,
            },
            p_note: "Notification de succès reçue de PayDunya",
            p_payload: payload,
          });
        } else if (status === "failed" || status === "cancelled") {
          const reason = String(payload?.reason || payload?.description || "Échec rapporté par PayDunya");
          console.error(`❌ [PAYDUNYA CALLBACK FAILED] Décaissement échoué pour transfert ${transfer.id}:`, reason);
          await admin.rpc("transition_transfer", {
            p_id: transfer.id,
            p_from: ["payout_created", "payout_pending"],
            p_to: "payout_failed",
            p_patch: {
              failure_reason: reason,
              disburse_status: "failed",
            },
            p_note: `Notification d'échec reçue de PayDunya: ${reason}`,
            p_payload: payload,
          });
        } else {
          console.log(`ℹ️ [PAYDUNYA CALLBACK STATUS UPDATE] Statut '${status}' pour transfert ${transfer.id}`);
        }
      } else {
        console.warn(`⚠️ [PAYDUNYA CALLBACK] Aucun transfert associé au token ${token}`);
      }
    } else {
      console.warn("⚠️ [PAYDUNYA CALLBACK] Aucun token fourni dans le payload PayDunya");
    }

    return new Response("OK", { status: 200 });
  } catch (err: unknown) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ [PAYDUNYA CALLBACK EXCEPTION]", err);
    console.error("=".repeat(60) + "\n");
    return new Response("OK", { status: 200 }); // toujours 200 pour accuser réception
  }
}
