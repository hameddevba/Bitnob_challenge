"use client";

import { useEffect, useState } from "react";
import { fcfa, NETWORKS } from "../ui";
import { savedSpace, savedTransfers, type SavedSpace, type SavedTransfer } from "../store";

const STATUS: Record<string, { label: string; tone: "ok" | "wait" | "err" }> = {
  AWAITING_PAYMENT: { label: "À payer", tone: "wait" },
  PAYMENT_DETECTED: { label: "En cours", tone: "wait" },
  PAYOUT_PENDING: { label: "En cours", tone: "wait" },
  PAYOUT_PROCESSING: { label: "En cours", tone: "wait" },
  PAYOUT_SUCCESS: { label: "Reçu", tone: "ok" },
  PAYOUT_FAILED: { label: "Nouvel essai", tone: "wait" },
  EXPIRED: { label: "Expiré", tone: "err" },
  CANCELLED: { label: "Annulé", tone: "err" },
  REFUND_PENDING: { label: "Remboursement", tone: "err" },
  REFUNDED: { label: "Remboursé", tone: "err" },
  UNDERPAID: { label: "En vérification", tone: "err" },
};

// Affichés seulement quand ce téléphone n'a encore rien envoyé, toujours marqués « Exemple »
const EXAMPLES = [
  { who: "Awa Diop", network: "Wave", from: "Paris", amountFcfa: 25000 },
  { who: "Maman (Fatou Ndiaye)", network: "Orange Money", from: "Milan", amountFcfa: 50000 },
  { who: "Cagnotte scolarité", network: "Wave", from: "Montréal", amountFcfa: 10000 },
];

const day =(iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Onglet « Activité » : les envois faits depuis ce téléphone + l'espace bénéficiaire
export default function ActivityPage() {
  const [items, setItems] = useState<SavedTransfer[] | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [space, setSpace] = useState<SavedSpace | null>(null);

  useEffect(() => {
    const list = savedTransfers();
    setItems(list);
    setSpace(savedSpace());
    // Statut à jour de chaque envoi (jeton de suivi gardé sur ce téléphone)
    list.slice(0, 15).forEach(async (t) => {
      const r = await fetch(`/api/transfers/${t.id}?token=${encodeURIComponent(t.token)}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) {
        const d = await r.json();
        setStatus((s) => ({ ...s, [t.id]: d.status }));
      }
    });
  }, []);

  if (!items) return <div className="screen"><p className="lede">Chargement…</p></div>;

  return (
    <div className="screen">
      <h1>Activité</h1>

      {space && (
        <a className="tile" href={space.manageLink}>
          <span className="tile-title">Mon espace bénéficiaire</span>
          <span className="tile-sub">Argent reçu par {space.name}, cagnottes</span>
          <span className="chev" aria-hidden>›</span>
        </a>
      )}

      <h2 className="group-title">Mes envois</h2>
      {items.length === 0 ? (
        <div className="empty">
          <p className="note" style={{ marginTop: 0 }}>Aucun envoi depuis ce téléphone pour l&apos;instant. Voici à quoi ressemblera votre historique :</p>
          <ul className="history demo" aria-label="Exemples d'envois">
            {EXAMPLES.map((e) => (
              <li key={e.who}>
                <div>
                  <div className="who">{e.who}</div>
                  <div className="when">{e.network}, depuis {e.from}</div>
                </div>
                <div className="right">
                  <div className="amt">{fcfa(e.amountFcfa)}</div>
                  <span className="tag demo">Exemple</span>
                </div>
              </li>
            ))}
          </ul>
          <a className="btn" href="/">Faire mon premier envoi</a>
        </div>
      ) : (
        <ul className="history tappable">
          {items.map((t) => {
            const s = STATUS[status[t.id]] ?? { label: "…", tone: "wait" as const };
            const network = NETWORKS.find((n) => n.value === t.network)?.label ?? t.network;
            return (
              <li key={t.id}>
                <a href={`/pay/${t.id}?token=${encodeURIComponent(t.token)}`}>
                  <div>
                    <div className="who">{t.recipientName}</div>
                    <div className="when">{network}, {day(t.at)}</div>
                  </div>
                  <div className="right">
                    <div className="amt">{fcfa(t.amountFcfa)}</div>
                    <span className={`tag ${s.tone}`}>{s.label}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <p className="note">Cet historique est gardé sur ce téléphone uniquement.</p>
    </div>
  );
}
