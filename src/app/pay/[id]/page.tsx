"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { btc, fcfa, NETWORKS, sats } from "../../ui";

type Status =
  | "CREATED" | "AWAITING_PAYMENT" | "PAYMENT_DETECTED" | "UNDERPAID" | "PAYOUT_PENDING"
  | "PAYOUT_PROCESSING" | "PAYOUT_SUCCESS" | "PAYOUT_FAILED" | "EXPIRED" | "CANCELLED" | "REFUND_PENDING";

type Transfer = {
  id: string; status: Status; amountFcfa: number; feeFcfa: number; totalSats: number;
  recipientName: string; recipientPhone: string; recipientNetwork: string;
  paymentRequest: string | null; expiresAt: string | null;
  simulated?: boolean; canSimulate?: boolean;
};

const FAILED: Status[] = ["PAYOUT_FAILED", "EXPIRED", "CANCELLED", "REFUND_PENDING", "UNDERPAID"];
const TERMINAL: Status[] = ["PAYOUT_SUCCESS", ...FAILED];

// Avancement : 0 = attente paiement, 1 = payé, 2 = envoi mobile money, 3 = reçu
function progress(s: Status): number {
  if (s === "PAYOUT_SUCCESS") return 3;
  if (s === "PAYOUT_PROCESSING") return 2;
  if (s === "PAYMENT_DETECTED" || s === "PAYOUT_PENDING" || s === "PAYOUT_FAILED" || s === "REFUND_PENDING") return 1;
  return 0;
}

const FAIL_TEXT: Partial<Record<Status, string>> = {
  EXPIRED: "La facture a expiré avant le paiement. Aucun fonds n'a été débité.",
  CANCELLED: "Le transfert a été annulé. Aucun fonds n'a été débité.",
  PAYOUT_FAILED: "Paiement reçu, mais l'envoi mobile money a échoué. Nous relançons automatiquement.",
  REFUND_PENDING: "L'envoi n'a pas pu aboutir. Un remboursement est en cours.",
  UNDERPAID: "Montant reçu insuffisant. Le transfert est en revue.",
};

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  return Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
}

function PayView({ id }: { id: string }) {
  const token = useSearchParams().get("token") ?? "";
  const [t, setT] = useState<Transfer | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  async function simulate() {
    setSimulating(true);
    try {
      const res = await fetch(`/api/transfers/${id}/simulate?token=${encodeURIComponent(token)}`, { method: "POST" });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`);
    } finally {
      setSimulating(false);
      setRefreshKey((k) => k + 1); // relance le polling
    }
  }
  const left = useCountdown(t?.status === "AWAITING_PAYMENT" ? t.expiresAt : null);

  // Polling du statut (le webhook Bitnob met la base à jour côté serveur)
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const res = await fetch(`/api/transfers/${id}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Transfert introuvable." : `Erreur ${res.status}`);
        const data = (await res.json()) as Transfer;
        if (stop) return;
        setT(data);
        setError(null);
        if (TERMINAL.includes(data.status)) return;
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, token, refreshKey]);

  useEffect(() => {
    if (t?.paymentRequest) {
      QRCode.toDataURL(`lightning:${t.paymentRequest}`.toUpperCase(), { width: 560, margin: 1 }).then(setQr);
    }
  }, [t?.paymentRequest]);

  if (error && !t) return <section className="card"><h1>Oups</h1><div className="alert err">{error}</div></section>;
  if (!t) return <section className="card"><p className="sub">Chargement…</p></section>;

  const network = NETWORKS.find((n) => n.value === t.recipientNetwork)?.label ?? t.recipientNetwork;
  const p = progress(t.status);
  const failed = FAILED.includes(t.status);
  const steps = [
    "Paiement Lightning reçu",
    `Envoi vers ${network} Money`,
    `${fcfa(t.amountFcfa)} reçus par ${t.recipientName}`,
  ];

  if (t.status === "PAYOUT_SUCCESS") {
    return (
      <>
        <div className="steps"><span className="on" /><span className="on" /><span className="on" /></div>
        <section className="card success">
          <div className="check">✓</div>
          <div className="big">{fcfa(t.amountFcfa)}</div>
          <p className="sub">envoyés à {t.recipientName} · {network} {t.recipientPhone}</p>
          {t.simulated && (
            <div className="alert warn">
              Simulation sandbox : paiement Lightning simulé, payout accepté par Bitnob sandbox. Aucun argent n&apos;a bougé.
            </div>
          )}
          <a className="btn" href="/">Nouvel envoi</a>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="steps"><span className="on" /><span className="on" /><span className="on" /></div>

      {t.status === "AWAITING_PAYMENT" && t.paymentRequest && (
        <section className="card">
          <h1>Payez {sats(t.totalSats)}</h1>
          <p className="sub">Scannez avec votre portefeuille Lightning · {btc(t.totalSats)}</p>
          <div className="qr">{qr ? <img src={qr} alt="QR code de la facture Lightning" /> : <p className="sub">QR…</p>}</div>
          {left !== null && (
            <div className={`countdown${left < 60 ? " low" : ""}`}>
              {left > 0 ? `Expire dans ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Facture expirée"}
            </div>
          )}
          <a className="btn dark" href={`lightning:${t.paymentRequest}`}>Ouvrir dans mon portefeuille</a>
          <button className="btn ghost" onClick={async () => {
            await navigator.clipboard.writeText(t.paymentRequest!);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copié ✓" : "Copier la facture"}</button>
          <div className="invoice">{t.paymentRequest}</div>
          {t.canSimulate && (
            <button className="btn sim" disabled={simulating} onClick={simulate}>
              {simulating ? "Simulation en cours…" : "Simuler le paiement (sandbox)"}
            </button>
          )}
        </section>
      )}

      <section className="card">
        <ul className="timeline" aria-live="polite">
          {steps.map((label, i) => {
            const cls = i < p ? "done" : i === p && !failed && t.status !== "AWAITING_PAYMENT" ? "now" : i === p && failed ? "fail" : "";
            return (
              <li key={label} className={cls}>
                <span className="dot">{i < p ? "✓" : cls === "fail" ? "!" : ""}</span>
                <span>{label}</span>
              </li>
            );
          })}
        </ul>
        {t.status === "AWAITING_PAYMENT" && <p className="hint">En attente du paiement… cette page se met à jour toute seule.</p>}
        {failed && <div className="alert err">{FAIL_TEXT[t.status]}</div>}
        {failed && <a className="btn ghost" href="/">Recommencer</a>}
        {error && <div className="alert err">{error}</div>}
      </section>
    </>
  );
}

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><PayView id={id} /></Suspense>;
}
