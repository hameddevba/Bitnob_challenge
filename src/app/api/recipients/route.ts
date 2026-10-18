import { rateLimit } from "@/lib/rateLimit";
import { createRecipient, HandleTakenError, ownerToken, publicBaseUrl, publicRecipient } from "@/lib/recipients";
import { createRecipientSchema } from "@/lib/validators";

// POST : créer un lien de paiement permanent (et l'adresse Lightning associée)
export async function POST(req: Request) {
  const limited = rateLimit(req, "recipient", 5);
  if (limited) return limited;
  const parsed = createRecipientSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  try {
    const r = await createRecipient(parsed.data);
    const base = publicBaseUrl(req);
    return Response.json({
      ...publicRecipient(r),
      link: `${base}/p/${r.handle}`,
      lightningAddress: `${r.handle}@${new URL(base).host}`,
      // Montré une seule fois : donne accès à l'historique et aux cagnottes
      manageLink: `${base}/p/${r.handle}/gerer?k=${ownerToken(r)}`,
    }, { status: 201 });
  } catch (e) {
    if (e instanceof HandleTakenError) {
      return Response.json({ error: e.message, details: { handle: [e.message] } }, { status: 409 });
    }
    console.error("create recipient", e);
    return Response.json({ error: "Création impossible, réessayez." }, { status: 500 });
  }
}
