import type { PoolClient } from "pg";
import { pool } from "./db";
import { createInvoice, createPayoutQuote } from "./bitnob";
import { priceFromQuote } from "./pricing";
import type { CreateTransferInput } from "./validators";

const FEE_PERCENT = () => Number(process.env.SERVICE_FEE_PERCENT ?? 1.5);

export async function logEvent(
  db: Pick<PoolClient, "query">, transferId: string | null, source: string, type: string, payload: unknown,
) {
  await db.query(
    `INSERT INTO transfer_events(transfer_id, source, event_type, payload) VALUES ($1,$2,$3,$4)`,
    [transferId, source, type, JSON.stringify(payload ?? null)]);
}

// La facture doit expirer avant la cotation Bitnob (~6 min), avec 60 s de marge.
export function invoiceExpirySeconds(quoteExpiresAt: string, now = Date.now()): number {
  const configured = Number(process.env.INVOICE_TTL_MINUTES ?? 10) * 60;
  const untilQuote = Math.floor((new Date(quoteExpiresAt).getTime() - now) / 1000) - 60;
  return Math.max(60, Math.min(configured, untilQuote));
}

// Validation du récapitulatif : nouvelle cotation, enregistrement, facture Lightning.
export async function createTransfer(input: CreateTransferInput) {
  const quote = await createPayoutQuote({
    settlementAmountFcfa: input.amountFcfa, reference: `q-${crypto.randomUUID()}`,
  });
  const price = priceFromQuote(quote, input.amountFcfa, FEE_PERCENT());

  const { rows } = await pool.query(
    `INSERT INTO transfers
      (amount_fcfa, fee_fcfa, amount_btc_sats, payout_cost_sats, rate_btc_xof, rate_expires_at,
       recipient_name, recipient_phone, recipient_network, sender_name, sender_country,
       refund_address, bitnob_quote_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'CREATED')
     RETURNING id, access_token`,
    [price.amountFcfa, price.feeFcfa, price.totalSats, price.payoutCostSats, price.rateBtcXof,
     price.quoteExpiresAt, input.recipientName, input.recipientPhone, input.recipientNetwork,
     input.senderName, input.senderCountry, input.refundAddress || null, quote.quote_id]);
  const { id, access_token } = rows[0] as { id: string; access_token: string };
  await logEvent(pool, id, "bitnob", "quote_created", quote);

  try {
    const invoice = await createInvoice({
      amountSats: price.totalSats,
      description: `Envoi ${price.amountFcfa} FCFA vers ${input.recipientNetwork} Money`,
      reference: id, // idempotent : un transfert = une facture
      expirySeconds: invoiceExpirySeconds(price.quoteExpiresAt),
    });
    await pool.query(
      `UPDATE transfers SET ln_invoice_id=$1, ln_payment_request=$2, ln_payment_hash=$3,
         expires_at=$4, status='AWAITING_PAYMENT' WHERE id=$5`,
      [invoice.id, invoice.request, invoice.payment_hash, invoice.expires_at, id]);
    await logEvent(pool, id, "bitnob", "invoice_created", invoice);
    return { id, accessToken: access_token, price, invoice };
  } catch (e) {
    await pool.query(`UPDATE transfers SET status='CANCELLED' WHERE id=$1`, [id]);
    await logEvent(pool, id, "system", "invoice_error", { error: (e as Error).message });
    throw e;
  }
}

// Vue publique d'un transfert (page de suivi), protégée par le jeton d'accès.
export async function getTransferForViewer(id: string, token: string) {
  const { rows } = await pool.query(
    `SELECT id, status, amount_fcfa, fee_fcfa, amount_btc_sats, recipient_name, recipient_phone,
            recipient_network, ln_payment_request, expires_at, payout_status, created_at, updated_at
     FROM transfers WHERE id=$1 AND access_token=$2`, [id, token]);
  return rows[0] ?? null;
}
