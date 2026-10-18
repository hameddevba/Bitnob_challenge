import { reconcile } from "@/lib/transfers";

// Tâche périodique : paiements non notifiés, expirations, payouts en attente ou échoués.
// Appel : GET /api/cron/reconcile avec Authorization: Bearer $CRON_SECRET
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("forbidden", { status: 403 });
  }
  return Response.json({ checked: await reconcile() });
}
