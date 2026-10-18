import { pool } from "@/lib/db";
import { maskPhone } from "@/lib/validators";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/transfers/:id/receipt?token=… : reçu d'un envoi abouti, avec la preuve Lightning
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(id) || !token) return Response.json({ error: "Introuvable" }, { status: 404 });

  const { rows } = await pool.query(
    `SELECT t.*,
       (SELECT max(e.created_at) FROM transfer_events e
         WHERE e.transfer_id=t.id AND e.event_type IN ('payout_finalized','payout_synced','payout_resynced','payout_simulated','webhook:payouts.withdrawal.success')) AS completed_at
     FROM transfers t WHERE t.id=$1 AND t.access_token=$2`, [id, token]);
  const t = rows[0];
  if (!t) return Response.json({ error: "Introuvable" }, { status: 404 });
  if (t.status !== "PAYOUT_SUCCESS") return Response.json({ error: "Le reçu est disponible une fois l'envoi abouti" }, { status: 409 });

  return Response.json({
    id: t.id,
    amountFcfa: Number(t.amount_fcfa),
    feeFcfa: Number(t.fee_fcfa),
    paidSats: Number(t.btc_received_sats || t.amount_btc_sats),
    recipientName: t.recipient_name,
    recipientPhone: maskPhone(t.recipient_phone),
    recipientNetwork: t.recipient_network,
    senderName: t.sender_name,
    origin: t.origin,
    createdAt: t.created_at,
    completedAt: t.completed_at ?? t.updated_at,
    payoutReference: t.bitnob_payout_id,
    simulated: t.payout_status === "SIMULATED",
    proof: t.ln_preimage ? { paymentHash: t.ln_payment_hash, preimage: t.ln_preimage } : null,
  });
}
