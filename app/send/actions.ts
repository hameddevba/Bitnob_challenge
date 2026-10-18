"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createQuote, createTransfer, UserError } from "@/lib/server/services";

export type QuoteResult =
  | { ok: true; quote: Awaited<ReturnType<typeof createQuote>> }
  | { ok: false; error: string };

/** Étape 1 : montant → devis */
export async function quoteAction(amountXof: number): Promise<QuoteResult> {
  const user = await requireUser(); // toujours revérifier
  if (!user) return { ok: false, error: "Session expirée, reconnectez-vous" };

  try {
    return { ok: true, quote: await createQuote(user.id, Number(amountXof)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message }; // messages de limites : sans danger
  }
}

/** Étape 3 : validation → facture Lightning, puis redirection vers la page de suivi */
export async function createTransferAction(input: {
  quoteId: string;
  name: string;
  country: string;
  phone: string;
}): Promise<{ ok: false; error: string }> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Session expirée, reconnectez-vous" };

  let id: string;
  try {
    id = await createTransfer(user.id, input);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("createTransfer error:", e);
    return { ok: false, error: "Impossible de créer le transfert" }; // détail interne jamais exposé
  }
  redirect(`/transfers/${id}`); // hors try/catch : redirect() lève une exception de contrôle
}
