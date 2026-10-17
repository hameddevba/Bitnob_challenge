import { getTransferForViewer } from "@/lib/transfers";
import { maskPhone } from "@/lib/validators";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/transfers/:id?token=… : statut (polling de la page de paiement)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(id) || !token) return Response.json({ error: "Introuvable" }, { status: 404 });

  const t = await getTransferForViewer(id, token);
  if (!t) return Response.json({ error: "Introuvable" }, { status: 404 });

  return Response.json({
    id: t.id,
    status: t.status,
    amountFcfa: Number(t.amount_fcfa),
    feeFcfa: Number(t.fee_fcfa),
    totalSats: Number(t.amount_btc_sats),
    recipientName: t.recipient_name,
    recipientPhone: maskPhone(t.recipient_phone),
    recipientNetwork: t.recipient_network,
    paymentRequest: t.status === "AWAITING_PAYMENT" ? t.ln_payment_request : null,
    expiresAt: t.expires_at,
    updatedAt: t.updated_at,
  });
}
