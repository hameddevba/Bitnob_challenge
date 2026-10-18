// Journal technique d'un envoi (page « sous le capot ») : masquage et libellés lisibles.

// Masque les numéros de téléphone et de compte avant d'exposer le journal
export function sanitize(payload: unknown): unknown {
  const text = JSON.stringify(payload ?? null)
    .replace(/"(account_number|recipient_phone|phone)"\s*:\s*"([^"]*)"/g,
      (_m, k: string, v: string) => `"${k}":"${v.slice(0, 2)}•••${v.slice(-2)}"`)
    .replace(/(?<![\d•])(\+?221)?7\d{8}(?!\d)/g, (m) => `${m.slice(0, 2)}•••${m.slice(-2)}`);
  return JSON.parse(text);
}

type P = Record<string, any> | null;
const n = (v: unknown) => new Intl.NumberFormat("fr-FR").format(Number(v)).replace(/ /g, " ");

// Libellé humain d'un événement + étape concernée (paiement entrant, envoi, remboursement…)
export function describe(type: string, source: string, p: P): { title: string; detail?: string; tone: "info" | "ok" | "err" } {
  switch (type) {
    case "quote_created":
    case "quote_refreshed":
      return {
        title: type === "quote_created" ? "Cotation Bitnob" : "Nouvelle cotation Bitnob",
        detail: p ? `${n(p.settlement_amount)} FCFA = ${n(p.sat_amount)} sats, valable jusqu'à ${new Date(p.expires_at).toLocaleTimeString("fr-FR")}` : undefined,
        tone: "info",
      };
    case "invoice_created":
      return { title: "Facture Lightning créée", detail: p ? `${n(p.amount_sat)} sats, empreinte ${String(p.payment_hash).slice(0, 12)}…` : undefined, tone: "info" };
    case "payment_confirmed":
      return { title: "Paiement confirmé chez Bitnob", detail: "Facture au statut « paid » avec sa preimage, vérifiée par appel à l'API (le corps du webhook n'est jamais cru seul)", tone: "ok" };
    case "payment_simulated":
      return { title: "Paiement simulé (sandbox)", detail: "Aucun bitcoin réel", tone: "info" };
    case "payout_attempt":
      return { title: `Envoi mobile money, tentative ${p?.attempt ?? ""}`, detail: "Verrou posé : un seul envoi possible pour ce transfert", tone: "info" };
    case "payout_initialized":
      return { title: "Payout Bitnob initialisé", detail: p ? `${p.beneficiary?.network ?? ""} ${p.beneficiary?.account_number ?? ""}, référence ${String(p.reference).slice(0, 14)}…` : undefined, tone: "info" };
    case "payout_finalized":
    case "payout_synced":
    case "payout_resynced":
      return { title: `Payout ${String(p?.status ?? "").toLowerCase() || "mis à jour"}`, detail: "Statut lu chez Bitnob", tone: String(p?.status).toUpperCase() === "COMPLETED" ? "ok" : "info" };
    case "payout_error":
      return { title: "Erreur Bitnob sur le payout", detail: p?.body?.code ?? p?.error, tone: "err" };
    case "payout_simulated":
      return { title: "Envoi accepté, finalisation simulée", detail: "Solde sandbox vide", tone: "ok" };
    case "payout_abandoned":
      return { title: "Envoi abandonné après plusieurs essais", tone: "err" };
    case "requote_too_expensive":
      return { title: "Cours trop défavorable : envoi bloqué pour ne pas perdre d'argent", tone: "err" };
    case "expired":
      return { title: "Facture expirée sans paiement", tone: "err" };
    case "refund_attempt":
      return { title: `Remboursement, tentative ${p?.attempt ?? ""}`, detail: p?.address, tone: "info" };
    case "refund_payment":
      return { title: `Remboursement ${p?.status === "paid" ? "envoyé" : String(p?.status ?? "")}`, detail: p ? `${n(p.amount_sat)} sats` : undefined, tone: p?.status === "paid" ? "ok" : "info" };
    case "refund_error":
      return { title: "Échec du remboursement", detail: p?.error, tone: "err" };
    case "invoice_error":
      return { title: "Création de facture impossible", detail: p?.error, tone: "err" };
    case "webhook_processing_error":
      return { title: "Webhook reçu, traitement reporté", detail: p?.error, tone: "err" };
    default:
      if (type.startsWith("webhook:")) {
        return { title: `Webhook Bitnob : ${type.slice(8)}`, detail: "Signature HMAC-SHA512 vérifiée, doublons ignorés", tone: "info" };
      }
      return { title: type, detail: source, tone: "info" };
  }
}
