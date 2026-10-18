import { decode } from "light-bolt11-decoder";
import { pool, withTx } from "./db";
import { BitnobError, payInvoice } from "./bitnob";
import { logEvent, payoutCanStillComplete } from "./transfers";

// Remboursement automatique vers l'adresse Lightning de l'expéditeur (LUD-16).
// Garde-fous : domaine public en HTTPS uniquement, montant de la facture vérifié avant paiement,
// un seul remboursement par transfert (référence idempotente), frais plafonnés et déduits.

const MAX_REFUND_ATTEMPTS = 3;

export function maxRoutingFee(sats: number): number {
  return Math.max(10, Math.ceil(sats * 0.01)); // 1 %, minimum 10 sats
}

export function refundAmount(receivedSats: number): number {
  return receivedSats - maxRoutingFee(receivedSats); // on ne rembourse jamais plus que reçu
}

// Refuse localhost, IP littérales et domaines internes (anti-SSRF)
export function lightningAddressUrl(address: string): URL {
  const m = /^([a-z0-9._+-]{1,64})@((?:[a-z0-9-]+\.)+[a-z]{2,})$/i.exec(address.trim());
  if (!m) throw new Error("Adresse Lightning invalide");
  const [, user, domain] = m;
  if (/(^|\.)(localhost|local|internal|lan|home|test)$/i.test(domain)) throw new Error("Domaine non autorisé");
  return new URL(`https://${domain.toLowerCase()}/.well-known/lnurlp/${encodeURIComponent(user.toLowerCase())}`);
}

async function fetchJson(url: URL, fetchImpl: typeof fetch): Promise<any> {
  if (url.protocol !== "https:") throw new Error("HTTPS obligatoire");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: "error", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url.host}`);
  return res.json();
}

export function invoiceAmountSats(request: string): { sats: number; expiresAt: number } {
  const sections = decode(request).sections as { name: string; value?: unknown }[];
  const msat = Number(sections.find((s) => s.name === "amount")?.value);
  const ts = Number(sections.find((s) => s.name === "timestamp")?.value);
  const expiry = Number(sections.find((s) => s.name === "expiry")?.value ?? 3600);
  if (!Number.isFinite(msat) || msat <= 0) throw new Error("Facture sans montant");
  return { sats: msat / 1000, expiresAt: (ts + expiry) * 1000 };
}

// Résout l'adresse et obtient une facture d'exactement `sats`, sinon lève une erreur.
export async function invoiceForAddress(address: string, sats: number, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const meta = await fetchJson(lightningAddressUrl(address), fetchImpl);
  if (meta?.tag !== "payRequest" || typeof meta.callback !== "string") throw new Error("Adresse Lightning non compatible");
  const msat = sats * 1000;
  if (msat < Number(meta.minSendable) || msat > Number(meta.maxSendable)) {
    throw new Error(`Montant hors limites du portefeuille (${meta.minSendable / 1000} à ${meta.maxSendable / 1000} sats)`);
  }
  const cb = new URL(meta.callback);
  cb.searchParams.set("amount", String(msat));
  const res = await fetchJson(cb, fetchImpl);
  if (res?.status === "ERROR" || typeof res?.pr !== "string") throw new Error(res?.reason ?? "Pas de facture renvoyée");

  const inv = invoiceAmountSats(res.pr);
  if (inv.sats !== sats) throw new Error(`Facture de ${inv.sats} sats au lieu de ${sats} : paiement refusé`);
  if (inv.expiresAt <= now) throw new Error("Facture déjà expirée");
  return res.pr as string;
}

// Rembourse un transfert REFUND_PENDING ou UNDERPAID qui a une adresse de remboursement.
export async function attemptRefund(transferId: string): Promise<"refunded" | "pending" | "skipped" | "failed" | "blocked"> {
  // Jamais de remboursement si le payout peut encore livrer les FCFA (sinon l'argent part deux fois).
  const { rows: pre } = await pool.query(
    `SELECT status, bitnob_payout_id, refund_address FROM transfers WHERE id=$1`, [transferId]);
  if (!pre[0]?.refund_address || !["REFUND_PENDING", "UNDERPAID"].includes(pre[0].status)) return "skipped";
  if (await payoutCanStillComplete(transferId, pre[0].bitnob_payout_id)) {
    const { rows: last } = await pool.query(
      `SELECT event_type FROM transfer_events WHERE transfer_id=$1 ORDER BY id DESC LIMIT 1`, [transferId]);
    if (last[0]?.event_type !== "refund_blocked") {
      await logEvent(pool, transferId, "system", "refund_blocked",
        { reason: "payout encore actif chez Bitnob : remboursement suspendu jusqu'à son échec ou son expiration" });
    }
    return "blocked";
  }

  const claim = await withTx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM transfers WHERE id=$1 AND status IN ('REFUND_PENDING','UNDERPAID')
         AND refund_address IS NOT NULL FOR UPDATE SKIP LOCKED`, [transferId]);
    const t = rows[0];
    if (!t) return null;
    const { rows: n } = await c.query(
      `SELECT count(*)::int AS n FROM transfer_events WHERE transfer_id=$1 AND event_type='refund_attempt'`, [transferId]);
    if (n[0].n >= MAX_REFUND_ATTEMPTS) return null;
    const reference = t.refund_reference ?? `rf-${t.id}-${n[0].n + 1}`;
    await c.query(`UPDATE transfers SET refund_reference=$1 WHERE id=$2`, [reference, transferId]);
    await logEvent(c, transferId, "system", "refund_attempt", { attempt: n[0].n + 1, address: t.refund_address });
    return { t, reference };
  });
  if (!claim) return "skipped";

  const received = Number(claim.t.btc_received_sats);
  const amount = refundAmount(received);
  try {
    if (amount <= 0) throw new Error("Montant trop faible pour un remboursement");
    const request = await invoiceForAddress(claim.t.refund_address, amount);
    const pay = await payInvoice({ request, reference: claim.reference, maxFeeSats: maxRoutingFee(received) });
    await logEvent(pool, transferId, "bitnob", "refund_payment", pay);

    if (pay.status === "paid") {
      await pool.query(`UPDATE transfers SET status='REFUNDED', refunded_sats=$1 WHERE id=$2`, [Number(pay.amount_sat), transferId]);
      return "refunded";
    }
    if (pay.status === "failed") {
      await pool.query(`UPDATE transfers SET refund_reference=NULL WHERE id=$1`, [transferId]); // nouvel essai possible
      return "failed";
    }
    return "pending"; // résultat confirmé plus tard avec la même référence
  } catch (e) {
    const err = e as Error;
    // Erreur avant l'envoi (résolution, montant) : on libère la référence pour un nouvel essai.
    // Erreur Bitnob ambiguë (5xx) : on garde la référence, le prochain essai sera idempotent.
    const ambiguous = e instanceof BitnobError && e.status >= 500;
    if (!ambiguous) await pool.query(`UPDATE transfers SET refund_reference=NULL WHERE id=$1`, [transferId]);
    await logEvent(pool, transferId, "system", "refund_error", { error: err.message, body: (e as BitnobError).body ?? null });
    return "failed";
  }
}
