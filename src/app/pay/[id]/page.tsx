"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { btc, fcfa, NETWORKS, num } from "../../ui";

type Status =
  | "CREATED" | "AWAITING_PAYMENT" | "PAYMENT_DETECTED" | "UNDERPAID" | "PAYOUT_PENDING"
  | "PAYOUT_PROCESSING" | "PAYOUT_SUCCESS" | "PAYOUT_FAILED" | "EXPIRED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";

type Transfer = {
  id: string; status: Status; amountFcfa: number; feeFcfa: number; totalSats: number;
  recipientName: string; recipientPhone: string; recipientNetwork: string;
  paymentRequest: string | null; expiresAt: string | null;
  simulated?: boolean; canSimulate?: boolean;
  refundAddress?: string | null; refundedSats?: number | null;
};

const FAILED: Status[] = ["PAYOUT_FAILED", "EXPIRED", "CANCELLED", "REFUND_PENDING", "UNDERPAID", "REFUNDED"];
const TERMINAL: Status[] = ["PAYOUT_SUCCESS", "EXPIRED", "CANCELLED", "REFUNDED"];
const nf = { format: num };

// Avancement : 0 = attente paiement, 1 = payé, 2 = envoi mobile money, 3 = reçu
function progress(s: Status): number {
  if (s === "PAYOUT_SUCCESS") return 3;
  if (s === "PAYOUT_PROCESSING") return 2;
  if (s === "PAYMENT_DETECTED" || s === "PAYOUT_PENDING" || s === "PAYOUT_FAILED" || s === "REFUND_PENDING" || s === "REFUNDED") return 1;
  return 0;
}

const FAIL_TEXT: Partial<Record<Status, string>> = {
  EXPIRED: "La facture a expiré avant le paiement. Aucun bitcoin n'a été débité.",
  CANCELLED: "L'envoi a été annulé. Aucun bitcoin n'a été débité.",
  PAYOUT_FAILED: "Paiement reçu, mais l'envoi mobile money a échoué. Une nouvelle tentative est en cours.",
  REFUND_PENDING: "L'envoi n'a pas pu aboutir. Votre remboursement est en préparation.",
  UNDERPAID: "Le montant reçu est insuffisant. L'envoi est en vérification.",
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
  const left = useCountdown(t?.status === "AWAITING_PAYMENT" ? t.expiresAt : null);

  async function simulate() {
    setSimulating(true);
    try {
      const res = await fetch(`/api/transfers/${id}/simulate?token=${encodeURIComponent(token)}`, { method: "POST" });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `Erreur ${res.status}`);
    } finally {
      setSimulating(false);
      setRefreshKey((k) => k + 1); // relance le suivi
    }
  }

  // Suivi du statut (le webhook Bitnob met la base à jour côté serveur)
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const res = await fetch(`/api/transfers/${id}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Cet envoi est introuvable. Vérifiez le lien." : `Erreur ${res.status}`);
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
      QRCode.toDataURL(`lightning:${t.paymentRequest}`.toUpperCase(), { width: 600, margin: 0, color: { dark: "#14213d" } }).then(setQr);
    }
  }, [t?.paymentRequest]);

  if (error && !t) return <div className="screen"><h1>Envoi introuvable</h1><div className="alert err">{error}</div></div>;
  if (!t) return <div className="screen"><p className="lede">Chargement de l&apos;envoi…</p></div>;

  const network = NETWORKS.find((n) => n.value === t.recipientNetwork)?.label ?? t.recipientNetwork;
  const p = progress(t.status);
  const failed = FAILED.includes(t.status);

  if (t.status === "PAYOUT_SUCCESS") {
    return (
      <div className="screen done-screen">
        <div className="seal" aria-hidden />
        <p className="sent">{nf.format(t.amountFcfa)}<br />FCFA</p>
        <p className="lede">envoyés à {t.recipientName}, {network} {t.recipientPhone}.</p>
        {t.simulated && (
          <div className="alert warn">
            Simulation sandbox : le paiement bitcoin a été simulé et Bitnob sandbox a accepté l&apos;envoi. Aucun argent n&apos;a bougé.
          </div>
        )}
        <div className="actions">
          <a className="btn" href={`/recu/${t.id}?token=${encodeURIComponent(token)}`}>Voir le reçu</a>
          <a className="btn secondary" href="/">Faire un nouvel envoi</a>
          <a className="text-btn" href={`/pay/${t.id}/journal?token=${encodeURIComponent(token)}`}>Voir ce qui s&apos;est passé sous le capot</a>
        </div>
      </div>
    );
  }

  const steps = [
    "Paiement bitcoin reçu",
    `Envoi sur ${network}`,
    `${t.recipientName} reçoit ${fcfa(t.amountFcfa)}`,
  ];

  return (
    <div className="screen">
      <div className="progress" aria-label="Étape 3 sur 3"><span className="on" /><span className="on" /><span className="on" /></div>

      {t.status === "AWAITING_PAYMENT" && t.paymentRequest ? (
        <>
          <h1>Scannez pour payer</h1>
          <p className="pay-amount">{nf.format(t.totalSats)}<small>sats</small></p>
          <p className="note">{btc(t.totalSats)} avec un portefeuille Lightning</p>
          <div className="qr">{qr ? <img src={qr} alt="QR code de la facture Lightning" /> : <p className="note">Préparation du QR code…</p>}</div>
          {left !== null && (
            <p className={`timer${left < 60 ? " low" : ""}`}>
              {left > 0 ? `Valable encore ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, "0")}` : "Facture expirée"}
            </p>
          )}
          <div className="actions inline">
            <a className="btn" href={`lightning:${t.paymentRequest}`}>Ouvrir mon portefeuille</a>
            <button className="btn secondary" onClick={async () => {
              await navigator.clipboard.writeText(t.paymentRequest!);
              setCopied(true); setTimeout(() => setCopied(false), 1500);
            }}>{copied ? "Facture copiée" : "Copier la facture"}</button>
            {t.canSimulate && (
              <button className="btn sim" disabled={simulating} onClick={simulate}>
                {simulating ? "Simulation…" : "Simuler le paiement (sandbox)"}
              </button>
            )}
          </div>
          <p className="invoice">{t.paymentRequest}</p>
        </>
      ) : (
        <>
          <h1>{failed ? "Envoi interrompu" : "Envoi en cours"}</h1>
          <p className="lede">{fcfa(t.amountFcfa)} pour {t.recipientName}</p>
        </>
      )}

      <ol className="track" aria-live="polite">
        {steps.map((label, i) => {
          const cls = i < p ? "done" : i === p && failed ? "fail" : i === p && t.status !== "AWAITING_PAYMENT" ? "now" : "";
          return <li key={label} className={cls}><span className="mark" aria-hidden />{label}</li>;
        })}
      </ol>
      {failed && (
        <div className={t.status === "REFUNDED" ? "alert warn" : "alert err"}>
          {t.status === "REFUNDED"
            ? `L'envoi n'a pas pu aboutir : ${num(t.refundedSats ?? 0)} sats ont été renvoyés sur ${t.refundAddress}.`
            : (t.status === "REFUND_PENDING" || t.status === "UNDERPAID") && t.refundAddress
              ? `L'envoi n'a pas pu aboutir. Vos sats sont en cours de renvoi sur ${t.refundAddress}.`
              : FAIL_TEXT[t.status]}
        </div>
      )}
      {error && t && <div className="alert err">{error}</div>}

      <a className="aside-link" style={{ marginTop: 4 }} href={`/pay/${t.id}/journal?token=${encodeURIComponent(token)}`}>Voir ce qui se passe sous le capot</a>
      {failed && <div className="actions"><a className="btn secondary" href="/">Recommencer</a></div>}
    </div>
  );
}

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><PayView id={id} /></Suspense>;
}
