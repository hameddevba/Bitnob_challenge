import { pool } from "@/lib/db";
import { potProgress, publicPot } from "@/lib/pots";
import { getRecipientForOwner, publicBaseUrl, publicRecipient } from "@/lib/recipients";

// GET : espace du bénéficiaire (historique des envois reçus + cagnottes). Jeton propriétaire requis.
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const r = await getRecipientForOwner(handle, req.headers.get("x-owner-token"));
  if (!r) return Response.json({ error: "Accès refusé" }, { status: 403 });
  const base = publicBaseUrl(req);

  const { rows: [totals] } = await pool.query(
    `SELECT coalesce(sum(amount_fcfa) FILTER (WHERE status='PAYOUT_SUCCESS'),0)::bigint AS received,
            count(*) FILTER (WHERE status='PAYOUT_SUCCESS')::int AS delivered,
            count(*) FILTER (WHERE status IN ('PAYOUT_PENDING','PAYOUT_PROCESSING'))::int AS in_progress
     FROM transfers WHERE recipient_id=$1`, [r.id]);

  const { rows: transfers } = await pool.query(
    `SELECT t.id, t.status, t.amount_fcfa, t.sender_name, t.sender_country, t.origin, t.payout_status,
            t.created_at, t.updated_at, p.title AS pot_title
     FROM transfers t LEFT JOIN pots p ON p.id = t.pot_id
     WHERE t.recipient_id=$1 AND t.status NOT IN ('CREATED','CANCELLED','AWAITING_PAYMENT','EXPIRED') -- seulement l'argent payé
     ORDER BY t.created_at DESC LIMIT 50`, [r.id]);

  const { rows: pots } = await pool.query(`SELECT * FROM pots WHERE recipient_id=$1 ORDER BY created_at DESC`, [r.id]);

  return Response.json({
    recipient: { ...publicRecipient(r), link: `${base}/p/${r.handle}`, lightningAddress: `${r.handle}@${new URL(base).host}` },
    totals: { receivedFcfa: Number(totals.received), delivered: totals.delivered, inProgress: totals.in_progress },
    transfers: transfers.map((t) => ({
      id: t.id,
      status: t.status,
      amountFcfa: Number(t.amount_fcfa),
      senderName: t.sender_name,
      senderCountry: t.sender_country,
      origin: t.origin,
      potTitle: t.pot_title,
      simulated: t.payout_status === "SIMULATED",
      at: t.updated_at,
    })),
    pots: await Promise.all(pots.map(async (p) => ({
      ...publicPot({ ...p, recipient: r }),
      link: `${base}/c/${p.slug}`,
      progress: await potProgress(p.id),
    }))),
  });
}
