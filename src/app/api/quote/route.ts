import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BitnobError, createPayoutQuote } from "@/lib/bitnob";
import { priceFromQuote } from "@/lib/pricing";

// Devis indicatif FCFA → sats (aucune écriture en base). Le devis définitif est
// recréé à la validation du transfert, la cotation Bitnob expirant en ~6 min.
const schema = z.object({
  amountFcfa: z.number().int()
    .min(Number(process.env.MIN_FCFA ?? 500))
    .max(Number(process.env.MAX_FCFA ?? 500000)),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: `Montant invalide (entre ${process.env.MIN_FCFA ?? 500} et ${process.env.MAX_FCFA ?? 500000} FCFA)` },
      { status: 400 });
  }
  try {
    const q = await createPayoutQuote({ settlementAmountFcfa: parsed.data.amountFcfa, reference: `q-${randomUUID()}` });
    return Response.json(priceFromQuote(q, parsed.data.amountFcfa, Number(process.env.SERVICE_FEE_PERCENT ?? 1.5)));
  } catch (e) {
    console.error("quote", e instanceof BitnobError ? e.body : e);
    return Response.json({ error: "Cotation indisponible, réessayez." }, { status: 502 });
  }
}
