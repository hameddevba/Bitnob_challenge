"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { verifyLightningProof as verifyProof } from "@/lib/proof";
import { fcfa, NETWORKS, num, sats } from "../../ui";

type Receipt = {
  id: string; amountFcfa: number; feeFcfa: number; paidSats: number;
  recipientName: string; recipientPhone: string; recipientNetwork: string; senderName: string;
  createdAt: string; completedAt: string; payoutReference: string | null; simulated: boolean;
  proof: { paymentHash: string; preimage: string } | null;
};

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });

function ReceiptView({ id }: { id: string }) {
  const token = useSearchParams().get("token") ?? "";
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<"idle" | "ok" | "ko">("idle");
  const [shared, setShared] = useState(false);

  useEffect(() => {
    fetch(`/api/transfers/${id}/receipt?token=${encodeURIComponent(token)}`)
      .then(async (res) => (res.ok ? setR(await res.json()) : setError((await res.json()).error ?? "Reçu introuvable")))
      .catch(() => setError("Reçu introuvable"));
  }, [id, token]);

  if (error) {
    return (
      <div className="screen">
        <h1>Reçu indisponible</h1>
        <div className="alert err">{error}</div>
        <div className="actions"><a className="btn secondary" href={`/pay/${id}?token=${encodeURIComponent(token)}`}>Revenir à l&apos;envoi</a></div>
      </div>
    );
  }
  if (!r) return <div className="screen"><p className="lede">Chargement du reçu…</p></div>;

  const network = NETWORKS.find((n) => n.value === r.recipientNetwork)?.label ?? r.recipientNetwork;
  const url = typeof window !== "undefined" ? window.location.href : "";
  const message = `Reçu Yónne : ${fcfa(r.amountFcfa)} envoyés à ${r.recipientName} sur ${network}. ${url}`;

  return (
    <div className="screen">
      <h1>Reçu d&apos;envoi</h1>
      <p className="pay-amount" style={{ marginTop: 8 }}>{num(r.amountFcfa)}<small>FCFA</small></p>
      <p className="note">reçus par {r.recipientName} le {date(r.completedAt)}</p>

      <div className="receipt">
        <div className="line"><span className="k">Bénéficiaire</span><span className="v">{r.recipientName}</span></div>
        <div className="line"><span className="k">{network}</span><span className="v">{r.recipientPhone}</span></div>
        <div className="line"><span className="k">Expéditeur</span><span className="v">{r.senderName}</span></div>
        <div className="line"><span className="k">Payé en bitcoin</span><span className="v sats">{sats(r.paidSats)}</span></div>
        <div className="line"><span className="k">Frais</span><span className="v">{fcfa(r.feeFcfa)}</span></div>
        {r.payoutReference && <div className="line"><span className="k">Référence Bitnob</span><span className="v mono">{r.payoutReference.slice(0, 13)}…</span></div>}
      </div>

      <h2 className="group-title">Preuve de paiement</h2>
      {r.proof ? (
        <div className="proof">
          <p className="note">Cette preuve est publique et infalsifiable : la preimage n&apos;est révélée qu&apos;une fois le paiement Lightning réglé, et son empreinte SHA-256 doit redonner l&apos;identifiant du paiement.</p>
          <div className="hash"><span>Identifiant du paiement</span><code>{r.proof.paymentHash}</code></div>
          <div className="hash"><span>Preimage</span><code>{r.proof.preimage}</code></div>
          {check === "idle" && <button className="btn secondary" onClick={async () => setCheck((await verifyProof(r.proof!)) ? "ok" : "ko")}>Vérifier la preuve</button>}
          {check === "ok" && <div className="alert ok">Preuve valide : SHA-256(preimage) correspond à l&apos;identifiant du paiement.</div>}
          {check === "ko" && <div className="alert err">Preuve invalide : l&apos;empreinte ne correspond pas.</div>}
        </div>
      ) : (
        <div className="alert warn">
          {r.simulated
            ? "Envoi simulé en sandbox : aucun paiement Lightning réel, donc pas de preuve cryptographique."
            : "La preuve Lightning n'est pas encore disponible pour cet envoi."}
        </div>
      )}

      <div className="actions">
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Partager sur WhatsApp</a>
        <div className="btn-row">
          <button className="btn secondary" onClick={async () => { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 1500); }}>
            {shared ? "Lien copié" : "Copier le lien"}
          </button>
          <a className="btn secondary" href="/">Nouvel envoi</a>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><ReceiptView id={id} /></Suspense>;
}
