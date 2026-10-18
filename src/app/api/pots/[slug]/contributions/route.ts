import { BitnobError } from "@/lib/bitnob";
import { getPot } from "@/lib/pots";
import { createLinkTransfer } from "@/lib/transfers";
import { contributionSchema } from "@/lib/validators";

// POST : contribuer à une cagnotte. Le bénéficiaire vient de la base, jamais du client.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pot = await getPot(slug);
  if (!pot) return Response.json({ error: "Cette cagnotte n'existe pas" }, { status: 404 });
  if (pot.closed) return Response.json({ error: "Cette cagnotte est clôturée" }, { status: 409 });

  const parsed = contributionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const t = await createLinkTransfer(pot.recipient, { ...parsed.data, pot: { id: pot.id, title: pot.title } });
    return Response.json({ id: t.id, token: t.accessToken, totalSats: t.price.totalSats }, { status: 201 });
  } catch (e) {
    console.error("pot contribution", e instanceof BitnobError ? e.body : e);
    return Response.json({ error: "Impossible de créer la contribution, réessayez." }, { status: 502 });
  }
}
