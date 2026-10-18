import { getPot, potProgress, publicPot } from "@/lib/pots";

// GET /api/pots/:slug : cagnotte publique (objectif, progression, contributeurs)
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pot = await getPot(slug);
  if (!pot) return Response.json({ error: "Cette cagnotte n'existe pas" }, { status: 404 });
  return Response.json({ ...publicPot(pot), progress: await potProgress(pot.id) });
}
