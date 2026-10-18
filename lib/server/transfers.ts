import "server-only";
import { admin } from "./supabase";
import { disburseOrangeMoney } from "./paydunya";

interface TransferForPayout {
  id: string;
  recipient_phone: string;
  amount_xof: number;
  withdraw_mode: string;
  payout_ref?: string | null;
}

/**
 * Traite les transferts prêts pour décaissement (statut btc_received ou payout_created)
 * Utilisé par le worker périodique et après réception d'un webhook
 */
export async function processPayouts() {
  console.log("\n" + "=".repeat(60));
  console.log("🔄 [WORKER] Recherche des transferts prêts pour décaissement PayDunya...");
  
  const { data: transfers, error } = await admin.rpc("claim_transfers_for_payout", { p_limit: 10 });
  if (error) {
    console.error("❌ [WORKER ERROR] Erreur RPC claim_transfers_for_payout:", error);
    console.log("=".repeat(60) + "\n");
    return { count: 0, error: error.message };
  }

  if (!transfers || transfers.length === 0) {
    console.log("ℹ️ [WORKER] Aucun transfert en attente de décaissement.");
    console.log("=".repeat(60) + "\n");
    return { count: 0, processed: [] };
  }

  console.log(`📋 [WORKER] ${transfers.length} transfert(s) prêts pour décaissement.`);
  console.log("=".repeat(60));

  const processed = [];
  for (const t of transfers as TransferForPayout[]) {
    const disburseId = t.payout_ref ? String(t.payout_ref) : `tx-${t.id}`;
    console.log(`\n💸 [DÉCAISSEMENT EN COURS] Transfert ID: ${t.id}`);
    console.log(`   Destinataire : ${t.recipient_phone}`);
    console.log(`   Montant      : ${t.amount_xof} FCFA`);
    console.log(`   Mode Orange  : ${t.withdraw_mode}`);
    console.log(`   Disburse ID  : ${disburseId}`);

    try {
      const { token, result } = await disburseOrangeMoney({
        phone: t.recipient_phone,
        amountFcfa: t.amount_xof,
        withdrawMode: t.withdraw_mode,
        disburseId,
      });

      await admin.rpc("transition_transfer", {
        p_id: t.id,
        p_from: ["btc_received", "payout_created"],
        p_to: "payout_pending",
        p_patch: {
          disburse_token: token,
          disburse_status: "pending",
        },
        p_note: "Déboursement soumis avec succès à PayDunya",
        p_payload: result,
      });

      console.log(`✅ [DÉCAISSEMENT RÉUSSI] Transfert ${t.id} passé en statut payout_pending (Token: ${token})`);
      processed.push({ id: t.id, status: "payout_pending" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`\n❌ [ÉCHEC DÉCAISSEMENT PAYDUNYA] pour le transfert ${t.id} (${t.recipient_phone}):`);
      console.error(`   Message d'erreur: ${msg}`);
      if (e instanceof Error && e.stack) {
        console.error(`   Détails de la trace:`, e.stack);
      }

      await admin.rpc("transition_transfer", {
        p_id: t.id,
        p_from: ["btc_received", "payout_created"],
        p_to: "payout_failed",
        p_patch: {
          failure_reason: msg,
          inc_attempts: 1,
        },
        p_note: `Erreur déboursement PayDunya: ${msg}`,
      });

      processed.push({ id: t.id, status: "payout_failed", error: msg });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`🏁 [WORKER FINI] ${processed.length} transfert(s) traités.`);
  console.log("=".repeat(60) + "\n");

  return { count: processed.length, processed };
}
