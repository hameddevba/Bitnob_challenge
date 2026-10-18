import { rateLimit } from "@/lib/rateLimit";
import { createPot, publicPot } from "@/lib/pots";
import { getRecipientForOwner, publicBaseUrl } from "@/lib/recipients";
import { createPotSchema } from "@/lib/validators";

// POST : créer une cagnotte (propriétaire du lien uniquement, en-tête x-owner-token)
export async function POST(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const limited = rateLimit(req, "pot", 10);
  if (limited) return limited;
  const { handle } = await params;
  const r = await getRecipientForOwner(handle, req.headers.get("x-owner-token"));
  if (!r) return Response.json({ error: "Accès refusé" }, { status: 403 });

  const parsed = createPotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const pot = await createPot(r, parsed.data);
  return Response.json({
    ...publicPot({ ...pot, recipient: r }),
    link: `${publicBaseUrl(req)}/c/${pot.slug}`,
  }, { status: 201 });
}
