import { pool } from "@/lib/db";
import { describe, sanitize } from "@/lib/journal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/transfers/:id/events?token=… : journal technique d'un envoi (page « sous le capot »)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(id) || !token) return Response.json({ error: "Introuvable" }, { status: 404 });

  const { rows: t } = await pool.query(
    `SELECT id, status, origin, amount_fcfa, amount_btc_sats, recipient_network, created_at
     FROM transfers WHERE id=$1 AND access_token=$2`, [id, token]);
  if (!t[0]) return Response.json({ error: "Introuvable" }, { status: 404 });

  const { rows } = await pool.query(
    `SELECT id, source, event_type, payload, created_at FROM transfer_events WHERE transfer_id=$1 ORDER BY id`, [id]);

  return Response.json({
    transfer: {
      id: t[0].id, status: t[0].status, origin: t[0].origin, network: t[0].recipient_network,
      amountFcfa: Number(t[0].amount_fcfa), totalSats: Number(t[0].amount_btc_sats), createdAt: t[0].created_at,
    },
    events: rows.map((e) => {
      const payload = sanitize(e.payload) as Record<string, unknown> | null;
      return { id: Number(e.id), source: e.source, type: e.event_type, at: e.created_at, ...describe(e.event_type, e.source, payload), payload };
    }),
  });
}
