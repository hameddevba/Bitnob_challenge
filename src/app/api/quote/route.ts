import { rateLimit } from "@/lib/rateLimit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BitnobError, createPayoutQuote } from "@/lib/bitnob";
import { MAX_FCFA, MIN_FCFA } from "@/lib/environment";
import { priceFromQuote } from "@/lib/pricing";
import { amountSchema } from "@/lib/validators";

// Devis indicatif FCFA → sats (aucune écriture en base). Le devis définitif est
// recréé à la validation du transfert, la cotation Bitnob expirant en ~6 min.
const schema = z.object({ amountFcfa: amountSchema });

export async function POST(req: Request) {
  const limited = rateLimit(req, "quote", 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Montant invalide (entre ${MIN_FCFA} et ${MAX_FCFA} FCFA)` }, { status: 400 });
  }
  try {
    const q = await createPayoutQuote({ settlementAmountFcfa: parsed.data.amountFcfa, reference: `q-${randomUUID()}` });
    return Response.json(priceFromQuote(q, parsed.data.amountFcfa, Number(process.env.SERVICE_FEE_PERCENT ?? 1.5)));
  } catch (e) {
    console.error("quote", e instanceof BitnobError ? e.body : e);
    return Response.json({ error: "Cotation indisponible, réessayez." }, { status: 502 });
  }
}
