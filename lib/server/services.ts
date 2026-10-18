import "server-only";
import { randomUUID } from "node:crypto";
import { admin } from "./supabase";
import { computeQuote } from "./pricing";
import { createInvoice } from "./bitnob";
import { ORANGE_MODE, PHONE_RULES } from "./paydunya";

/** Erreur dont le message peut être affiché à l'utilisateur */
export class UserError extends Error {}

function checkServiceRoleConfig() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !key ||
    key.trim().length < 20 ||
    key.startsWith("votre_") ||
    key.startsWith("placeholder")
  ) {
    throw new UserError(
      "Clé Supabase manquante : veuillez renseigner SUPABASE_SERVICE_ROLE_KEY dans .env.local avec votre clé secrète service_role (Supabase Dashboard > Settings > API)."
    );
  }
}

export async function createQuote(userId: string, amountXof: number) {
  checkServiceRoleConfig();
  const q = await computeQuote(amountXof); // lève une Error lisible (limites, entier…)
  const expiresAt = new Date(Date.now() + q.quoteTtl * 1000).toISOString();

  const insertData: Record<string, unknown> = {
    amount_xof: q.amountXof,
    fee_xof: q.feeXof,
    total_xof: q.totalXof,
    xof_per_btc: q.rate,
    amount_sats: q.amountSats,
    expires_at: expiresAt,
  };

  if (userId) {
    insertData.user_id = userId;
  }

  const { data, error } = await admin
    .from("quotes")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error("Erreur insertion quote:", error);
    if (error.message?.includes("Invalid API key") || error.code === "PGRST301") {
      throw new UserError(
        "Clé SUPABASE_SERVICE_ROLE_KEY invalide dans .env.local. Vérifiez que vous avez bien copié la clé secrète 'service_role' (et non la clé anon) depuis le tableau de bord Supabase."
      );
    }
    throw new Error(`Impossible d'enregistrer le devis en base : ${error.message || "erreur inconnue"}`);
  }

  return {
    quote_id: data.id as string,
    amount_xof: data.amount_xof as number,
    fee_xof: data.fee_xof as number,
    total_xof: data.total_xof as number,
    amount_sats: Number(data.amount_sats),
    amount_btc: (Number(data.amount_sats) / 1e8).toFixed(8),
    expires_at: data.expires_at as string,
  };
}

export async function createTransfer(
  userId: string,
  input: {
    quoteId: string;
    name: string;
    country: string;
    phone: string;
  }
) {
  checkServiceRoleConfig();
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new UserError("Nom invalide");

  const country = input.country.toUpperCase();
  if (!ORANGE_MODE[country]) throw new UserError("Pays non supporté");

  const phone = input.phone.replace(/\D/g, "");
  if (!PHONE_RULES[country] || !PHONE_RULES[country].test(phone)) {
    throw new UserError("Numéro Orange Money invalide pour ce pays");
  }

  let quoteQuery = admin.from("quotes").select("*").eq("id", input.quoteId);
  if (userId) {
    quoteQuery = quoteQuery.eq("user_id", userId);
  }

  const { data: quote, error: quoteErr } = await quoteQuery.maybeSingle();

  if (quoteErr || !quote) throw new UserError("Devis introuvable");
  if (quote.used_at) throw new UserError("Devis déjà utilisé");
  if (new Date(quote.expires_at) < new Date())
    throw new UserError("Devis expiré, recommencez");

  // Consommation atomique du devis (anti double-clic / rejeu)
  const { data: claimed } = await admin
    .from("quotes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", quote.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) throw new UserError("Devis déjà utilisé");

  const transferId = randomUUID();
  const secondsLeft = Math.max(
    60,
    Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000)
  );

  const inv = await createInvoice({
    amountSats: Number(quote.amount_sats),
    description: `Envoi ${quote.amount_xof} FCFA`,
    reference: `tx-${transferId}`,
    expirySeconds: secondsLeft,
  });

  const transferData: Record<string, unknown> = {
    id: transferId,
    quote_id: quote.id,
    amount_xof: quote.amount_xof,
    fee_xof: quote.fee_xof,
    total_xof: quote.total_xof,
    amount_sats: quote.amount_sats,
    xof_per_btc: quote.xof_per_btc,
    recipient_name: name,
    recipient_country: country,
    recipient_phone: phone,
    withdraw_mode: ORANGE_MODE[country],
    bitnob_invoice_id: inv.id,
    bitnob_reference: `tx-${transferId}`,
    payment_hash: inv.payment_hash,
    bolt11: inv.request,
    invoice_expires_at: new Date(Date.now() + secondsLeft * 1000).toISOString(),
  };

  if (userId) {
    transferData.user_id = userId;
  }

  const { error } = await admin.from("transfers").insert(transferData);

  if (error) {
    console.error("Erreur insertion transfert:", error);
    throw error;
  }

  await admin.from("transfer_events").insert({
    transfer_id: transferId,
    to_status: "awaiting_payment",
    note: "Facture Lightning créée",
  });

  return transferId;
}
