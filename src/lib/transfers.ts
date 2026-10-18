import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, withTx } from "./db";
import {
  createInvoice, createPayoutQuote, finalizePayout, getInvoice, getPayout, initializePayout,
  type Payout, type SnNetwork,
} from "./bitnob";
import {
  netSatsFromTotal, payoutCostSats, priceFromQuote, priceFromSatsQuote, satsToBtcString, type Pricing,
} from "./pricing";
import type { CreateTransferInput } from "./validators";

const FEE_PERCENT = () => Number(process.env.SERVICE_FEE_PERCENT ?? 1.5);
const MAX_PAYOUT_ATTEMPTS = 3;
const QUOTE_SAFETY_MS = 45_000; // on recote si la cotation expire dans moins de 45 s

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

// ---------- 1. Création (validation du récapitulatif) ----------

export type RecipientRow = {
  id: string; handle: string; recipient_name: string; recipient_phone: string;
  recipient_network: SnNetwork; recipient_country: string;
};

type NewTransfer = {
  price: Pricing;
  quote: Payout;
  recipient: { name: string; phone: string; network: string; country: string };
  sender: { name: string; country: string };
  refundAddress?: string | null;
  recipientId?: string | null;
  origin: "app" | "link" | "lightning_address";
  description: string;
};

// Saisie classique dans l'application
export async function createTransfer(input: CreateTransferInput) {
  const quote = await createPayoutQuote({
    settlementAmountFcfa: input.amountFcfa, reference: `q-${randomUUID()}`,
  });
  const price = priceFromQuote(quote, input.amountFcfa, FEE_PERCENT());
  return insertWithInvoice({
    price, quote, origin: "app",
    recipient: { name: input.recipientName, phone: input.recipientPhone, network: input.recipientNetwork, country: "SN" },
    sender: { name: input.senderName, country: input.senderCountry },
    refundAddress: input.refundAddress,
    description: `Envoi ${price.amountFcfa} FCFA à ${input.recipientName}`,
  });
}

// Lien de paiement permanent : le bénéficiaire vient de la base, jamais du client
export async function createLinkTransfer(r: RecipientRow, p: { amountFcfa: number; senderName: string; senderCountry: string }) {
  const quote = await createPayoutQuote({ settlementAmountFcfa: p.amountFcfa, reference: `q-${randomUUID()}` });
  const price = priceFromQuote(quote, p.amountFcfa, FEE_PERCENT());
  return insertWithInvoice({
    price, quote, origin: "link", recipientId: r.id,
    recipient: { name: r.recipient_name, phone: r.recipient_phone, network: r.recipient_network, country: r.recipient_country },
    sender: { name: p.senderName, country: p.senderCountry },
    description: `Envoi ${price.amountFcfa} FCFA à ${r.recipient_name}`,
  });
}

// Adresse Lightning : l'expéditeur fixe le total en sats depuis son portefeuille
export async function createLightningAddressTransfer(r: RecipientRow, totalSats: number, senderName: string) {
  const net = netSatsFromTotal(totalSats, FEE_PERCENT());
  const quote = await createPayoutQuote({ amountBtc: satsToBtcString(net), reference: `q-${randomUUID()}` });
  const price = priceFromSatsQuote(quote, totalSats);
  return insertWithInvoice({
    price, quote, origin: "lightning_address", recipientId: r.id,
    recipient: { name: r.recipient_name, phone: r.recipient_phone, network: r.recipient_network, country: r.recipient_country },
    sender: { name: senderName, country: r.recipient_country },
    description: `Envoi vers ${r.handle} (${r.recipient_network})`,
  });
}

async function insertWithInvoice(t: NewTransfer) {
  const { price, quote } = t;
  const { rows } = await pool.query(
    `INSERT INTO transfers
      (amount_fcfa, fee_fcfa, amount_btc_sats, payout_cost_sats, rate_btc_xof, rate_expires_at,
       recipient_name, recipient_phone, recipient_network, recipient_country, sender_name, sender_country,
       refund_address, bitnob_quote_id, recipient_id, origin, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'CREATED')
     RETURNING id, access_token`,
    [price.amountFcfa, price.feeFcfa, price.totalSats, price.payoutCostSats, price.rateBtcXof,
     price.quoteExpiresAt, t.recipient.name, t.recipient.phone, t.recipient.network, t.recipient.country,
     t.sender.name, t.sender.country, t.refundAddress || null, quote.quote_id, t.recipientId ?? null, t.origin]);
  const { id, access_token } = rows[0] as { id: string; access_token: string };
  await logEvent(pool, id, "bitnob", "quote_created", quote);

  try {
    const invoice = await createInvoice({
      amountSats: price.totalSats,
      description: t.description,
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

// ---------- 2. Paiement Lightning ----------
// Le webhook ne fait que déclencher : la preuve vient toujours de GET /api/lightning/invoices/:id
// (status 'paid' + preimage), jamais du corps du webhook.

export async function confirmPayment(transferId: string, source: string): Promise<string | null> {
  const { rows } = await pool.query(`SELECT status, ln_invoice_id FROM transfers WHERE id=$1`, [transferId]);
  const t0 = rows[0];
  if (!t0?.ln_invoice_id || !["AWAITING_PAYMENT", "EXPIRED"].includes(t0.status)) return t0?.status ?? null;

  const inv = await getInvoice(t0.ln_invoice_id);
  if (inv.status !== "paid") return t0.status;

  const status = await withTx(async (c) => {
    const { rows: locked } = await c.query(
      `SELECT status, amount_btc_sats FROM transfers WHERE id=$1 FOR UPDATE`, [transferId]);
    if (!["AWAITING_PAYMENT", "EXPIRED"].includes(locked[0].status)) return null; // déjà traité
    const received = Number(inv.amount_sat);
    const next = received >= Number(locked[0].amount_btc_sats) ? "PAYOUT_PENDING" : "UNDERPAID";
    await c.query(
      `UPDATE transfers SET status=$1, btc_received_sats=$2, ln_preimage=$3 WHERE id=$4`,
      [next, received, inv.preimage ?? null, transferId]);
    await logEvent(c, transferId, "bitnob", "payment_confirmed", { source, invoice: inv });
    return next;
  });

  if (status === "PAYOUT_PENDING") await runPayout(transferId);
  return status;
}

// ---------- 3. Payout mobile money ----------
// Un seul payout par transfert : verrou de ligne + état PAYOUT_PROCESSING + référence idempotente.

const PAYOUT_DONE = new Set(["COMPLETED"]);
const PAYOUT_DEAD = new Set(["FAILED", "EXPIRED"]);

function mapPayoutStatus(bitnobStatus: string): "PAYOUT_SUCCESS" | "PAYOUT_FAILED" | "PAYOUT_PROCESSING" {
  const s = bitnobStatus.toUpperCase();
  if (PAYOUT_DONE.has(s)) return "PAYOUT_SUCCESS";
  if (PAYOUT_DEAD.has(s)) return "PAYOUT_FAILED";
  return "PAYOUT_PROCESSING";
}

export async function runPayout(transferId: string): Promise<void> {
  const t = await withTx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM transfers WHERE id=$1 AND status IN ('PAYOUT_PENDING','PAYOUT_FAILED')
       FOR UPDATE SKIP LOCKED`, [transferId]);
    if (!rows[0]) return null;
    const { rows: n } = await c.query(
      `SELECT count(*)::int AS n FROM transfer_events WHERE transfer_id=$1 AND event_type='payout_attempt'`,
      [transferId]);
    if (n[0].n >= MAX_PAYOUT_ATTEMPTS) {
      await c.query(`UPDATE transfers SET status='REFUND_PENDING' WHERE id=$1`, [transferId]);
      await logEvent(c, transferId, "system", "payout_abandoned", { attempts: n[0].n });
      return null;
    }
    await c.query(
      `UPDATE transfers SET status='PAYOUT_PROCESSING', payout_status='SUBMITTING' WHERE id=$1`, [transferId]);
    await logEvent(c, transferId, "system", "payout_attempt", { attempt: n[0].n + 1 });
    return rows[0];
  });
  if (!t) return;

  try {
    let quoteId: string = t.bitnob_quote_id;
    let payoutId: string | null = t.bitnob_payout_id;
    let reference: string = t.payout_reference;
    const quoteExpiring = new Date(t.rate_expires_at).getTime() - Date.now() < QUOTE_SAFETY_MS;

    // Un payout déjà initialisé : vérifier chez Bitnob avant toute nouvelle tentative (anti double envoi).
    if (payoutId) {
      const existing = await getPayout(payoutId);
      const s = existing.status.toUpperCase();
      if (!PAYOUT_DEAD.has(s) && s !== "INITIATED" && s !== "QUOTE") {
        await applyPayoutStatus(transferId, existing.status, "payout_resynced", existing);
        return;
      }
      if (PAYOUT_DEAD.has(s) || quoteExpiring) {
        payoutId = null;
        reference = `po-${randomUUID()}`;
        await pool.query(
          `UPDATE transfers SET bitnob_payout_id=NULL, payout_reference=$1 WHERE id=$2`, [reference, transferId]);
      }
    }

    if (!payoutId) {
      if (quoteExpiring) {
        const q = await createPayoutQuote({ settlementAmountFcfa: Number(t.amount_fcfa), reference: `q-${randomUUID()}` });
        const cost = payoutCostSats(q);
        if (cost > Number(t.btc_received_sats)) {
          // Le cours a monté plus que nos frais : on n'envoie pas à perte, revue manuelle.
          await pool.query(`UPDATE transfers SET status='REFUND_PENDING', payout_status='REQUOTE_TOO_HIGH' WHERE id=$1`, [transferId]);
          await logEvent(pool, transferId, "system", "requote_too_expensive", { cost, received: t.btc_received_sats, quote: q });
          return;
        }
        quoteId = q.quote_id;
        await pool.query(
          `UPDATE transfers SET bitnob_quote_id=$1, rate_expires_at=$2, payout_cost_sats=$3 WHERE id=$4`,
          [q.quote_id, q.expires_at, cost, transferId]);
        await logEvent(pool, transferId, "bitnob", "quote_refreshed", q);
      }

      const init = await initializePayout(quoteId, {
        reference,
        accountName: t.recipient_name,
        phone: t.recipient_phone,
        network: t.recipient_network as SnNetwork,
        senderName: t.sender_name,
        senderCountry: t.sender_country,
        country: t.recipient_country,
        callbackUrl: process.env.APP_URL?.startsWith("https://") ? `${process.env.APP_URL}/api/webhooks/bitnob` : undefined,
      });
      await pool.query(
        `UPDATE transfers SET bitnob_payout_id=$1, payout_status=$2 WHERE id=$3`, [init.id, init.status, transferId]);
      await logEvent(pool, transferId, "bitnob", "payout_initialized", init);
    }

    const fin = await finalizePayout(quoteId);
    await applyPayoutStatus(transferId, fin.status, "payout_finalized", fin);
  } catch (e) {
    const err = e as Error & { body?: unknown };
    await pool.query(`UPDATE transfers SET status='PAYOUT_FAILED', payout_status='ERROR' WHERE id=$1`, [transferId]);
    await logEvent(pool, transferId, "bitnob", "payout_error", { error: err.message, body: err.body ?? null });
  }
}

async function applyPayoutStatus(transferId: string, bitnobStatus: string, eventType: string, payload: unknown) {
  const next = mapPayoutStatus(bitnobStatus);
  await withTx(async (c) => {
    const { rows } = await c.query(`SELECT status FROM transfers WHERE id=$1 FOR UPDATE`, [transferId]);
    if (rows[0]?.status === "PAYOUT_SUCCESS") return; // terminal, ne jamais revenir en arrière
    await c.query(`UPDATE transfers SET status=$1, payout_status=$2 WHERE id=$3`, [next, bitnobStatus, transferId]);
    await logEvent(c, transferId, "bitnob", eventType, payload);
  });
}

// Statut d'un payout en cours : la vérité vient de GET /api/payouts/:id.
export async function syncPayout(transferId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT status, bitnob_payout_id, payout_status FROM transfers WHERE id=$1`, [transferId]);
  const t = rows[0];
  if (!t?.bitnob_payout_id || t.status !== "PAYOUT_PROCESSING") return;
  const p = await getPayout(t.bitnob_payout_id);
  if (p.status.toUpperCase() === (t.payout_status ?? "").toUpperCase()) return;
  await applyPayoutStatus(transferId, p.status, "payout_synced", p);
  if (mapPayoutStatus(p.status) === "PAYOUT_FAILED") await runPayout(transferId);
}

// ---------- 4. Rafraîchissement (polling de la page + réconciliation) ----------
// Bitnob recommande de ne pas dépendre uniquement des webhooks.

const lastRefresh = new Map<string, number>();

export async function refreshTransfer(transferId: string, opts: { throttleMs?: number; retryFailed?: boolean } = {}) {
  const now = Date.now();
  if (opts.throttleMs && now - (lastRefresh.get(transferId) ?? 0) < opts.throttleMs) return;
  lastRefresh.set(transferId, now);

  const { rows } = await pool.query(`SELECT status, expires_at FROM transfers WHERE id=$1`, [transferId]);
  const t = rows[0];
  if (!t) return;

  if (t.status === "AWAITING_PAYMENT") {
    const s = await confirmPayment(transferId, "poll");
    if (s === "AWAITING_PAYMENT" && t.expires_at && new Date(t.expires_at).getTime() < now) {
      const { rowCount } = await pool.query(
        `UPDATE transfers SET status='EXPIRED' WHERE id=$1 AND status='AWAITING_PAYMENT'`, [transferId]);
      if (rowCount) await logEvent(pool, transferId, "system", "expired", null);
    }
  } else if (t.status === "PAYOUT_PROCESSING") {
    await syncPayout(transferId);
  } else if (t.status === "PAYOUT_PENDING" || (opts.retryFailed && t.status === "PAYOUT_FAILED")) {
    await runPayout(transferId);
  }
}

export async function reconcile() {
  const { rows } = await pool.query(
    `SELECT id FROM transfers
     WHERE status IN ('AWAITING_PAYMENT','PAYOUT_PENDING','PAYOUT_PROCESSING','PAYOUT_FAILED')
       AND created_at > now() - interval '2 days'
     ORDER BY created_at LIMIT 50`);
  const results: Record<string, string> = {};
  for (const r of rows) {
    try {
      await refreshTransfer(r.id, { retryFailed: true });
      results[r.id] = "ok";
    } catch (e) {
      results[r.id] = (e as Error).message;
    }
  }
  return results;
}

// ---------- 4 bis. Simulation sandbox (tests dans le navigateur) ----------
// Les factures sandbox (lntb…) ne sont payables par aucun portefeuille grand public.
// On simule UNIQUEMENT le paiement entrant ; le payout part réellement chez Bitnob sandbox.
// S'il échoue seulement faute de solde sandbox, on marque un succès « SIMULATED ».

export async function simulateSandboxPayment(transferId: string): Promise<string | null> {
  const { isSimulationEnabled } = await import("./environment");
  // Vérification fraîche chez Bitnob : jamais de simulation avec des clés de production.
  if (!(await isSimulationEnabled({ fresh: true }))) throw new Error("Simulation désactivée");

  const paid = await withTx(async (c) => {
    const { rows } = await c.query(`SELECT status FROM transfers WHERE id=$1 FOR UPDATE`, [transferId]);
    if (rows[0]?.status !== "AWAITING_PAYMENT") return false;
    await c.query(
      `UPDATE transfers SET status='PAYOUT_PENDING', btc_received_sats=amount_btc_sats WHERE id=$1`, [transferId]);
    await logEvent(c, transferId, "system", "payment_simulated", { note: "sandbox : paiement Lightning simulé" });
    return true;
  });
  if (!paid) return null;

  await runPayout(transferId);

  const { rows } = await pool.query(
    `SELECT t.status,
       (SELECT e.payload::text FROM transfer_events e WHERE e.transfer_id=t.id AND e.event_type='payout_error'
        ORDER BY e.id DESC LIMIT 1) AS last_error
     FROM transfers t WHERE t.id=$1`, [transferId]);
  const { status, last_error } = rows[0];
  if (status === "PAYOUT_FAILED" && String(last_error).includes("INSUFFICIENT_FUNDS")) {
    await pool.query(
      `UPDATE transfers SET status='PAYOUT_SUCCESS', payout_status='SIMULATED' WHERE id=$1 AND status='PAYOUT_FAILED'`,
      [transferId]);
    await logEvent(pool, transferId, "system", "payout_simulated",
      { note: "sandbox : payout accepté par Bitnob (initialize), finalisation simulée faute de solde sandbox" });
    return "PAYOUT_SUCCESS";
  }
  return status;
}

// ---------- 5. Retrouver un transfert depuis un webhook ----------

export async function findTransferIdForEvent(data: Record<string, unknown>): Promise<string | null> {
  const candidates = [data.reference, data.id, data.invoice_id, data.payment_hash, data.paymentHash]
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (!candidates.length) return null;
  const { rows } = await pool.query(
    `SELECT id FROM transfers
     WHERE id::text = ANY($1) OR ln_invoice_id = ANY($1) OR ln_payment_hash = ANY($1)
        OR payout_reference = ANY($1) OR bitnob_payout_id = ANY($1)
     LIMIT 1`, [candidates]);
  return rows[0]?.id ?? null;
}

// ---------- 6. Vue publique (page de suivi), protégée par le jeton d'accès ----------

export async function getTransferForViewer(id: string, token: string) {
  const { rows } = await pool.query(
    `SELECT id, status, amount_fcfa, fee_fcfa, amount_btc_sats, recipient_name, recipient_phone,
            recipient_network, ln_payment_request, expires_at, payout_status, created_at, updated_at
     FROM transfers WHERE id=$1 AND access_token=$2`, [id, token]);
  return rows[0] ?? null;
}
