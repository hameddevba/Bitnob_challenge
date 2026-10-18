"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, fcfa, MAX_FCFA, MIN_FCFA, NETWORKS, num, postJson, sats } from "../../ui";
import { useQuote } from "../../useQuote";

type Payee = { handle: string; name: string; phone: string; network: string; lightningAddress: string };
type Created = { id: string; token: string };

// Page publique d'un lien : l'expéditeur choisit le montant, le bénéficiaire est fixé.
export default function PayLinkPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const router = useRouter();
  const [payee, setPayee] = useState<Payee | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [raw, setRaw] = useState("10000");
  const [sender, setSender] = useState({ senderName: "", senderCountry: "FR", refundAddress: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amount = Number(raw.replace(/\D/g, ""));
  const { quote, loading, error: quoteError, inRange } = useQuote(amount);

  useEffect(() => {
    fetch(`/api/recipients/${encodeURIComponent(handle)}`)
      .then(async (r) => (r.ok ? setPayee(await r.json()) : setNotFound(true)))
      .catch(() => setNotFound(true));
  }, [handle]);

  if (notFound) {
    return (
      <div className="screen">
        <h1>Ce lien n&apos;existe pas</h1>
        <p className="lede">Vérifiez l&apos;adresse avec la personne qui vous l&apos;a envoyée.</p>
        <div className="actions"><a className="btn secondary" href="/">Envoyer de l&apos;argent</a></div>
      </div>
    );
  }
  if (!payee) return <div className="screen"><p className="lede">Chargement…</p></div>;

  const network = NETWORKS.find((n) => n.value === payee.network) ?? NETWORKS[0];
  const pending = loading ? "…" : "—";
  const valid = !!quote && sender.senderName.trim().length >= 2;

  async function pay() {
    setBusy(true); setError(null);
    try {
      const t = await postJson<Created>(`/api/recipients/${encodeURIComponent(handle)}/transfers`, { amountFcfa: amount, ...sender });
      router.push(`/pay/${t.id}?token=${t.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="payee">
        <div className="avatar" aria-hidden>
          {payee.name.trim()[0]?.toUpperCase()}
          <span className="dot" style={{ background: network.color }} />
        </div>
        <div>
          <div className="who">{payee.name}</div>
          <div className="where">{network.label} {payee.phone}</div>
        </div>
      </div>

      <h1>Combien envoyer à {payee.name.split(" ")[0]}{" "}?</h1>
      <p className="lede">{payee.name.split(" ")[0]} reçoit exactement ce montant sur {network.label}.</p>

      <div className="amount">
        <input inputMode="numeric" aria-label="Montant en FCFA" aria-invalid={!inRange && raw !== ""}
          value={raw ? num(amount) : ""} placeholder="0"
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 7))} />
        <span className="unit">FCFA</span>
      </div>
      {!inRange && raw !== "" && <p className="error-text">Choisissez un montant entre {fcfa(MIN_FCFA)} et {fcfa(MAX_FCFA)}.</p>}

      <div className="receipt" aria-live="polite">
        <div className="line"><span className="k">Frais</span><span className="v">{quote ? fcfa(quote.feeFcfa) : pending}</span></div>
        <div className="line total"><span className="k">À payer en bitcoin</span><span className="v sats">{quote ? sats(quote.totalSats) : pending}</span></div>
      </div>

      <div className="pair">
        <div className="field">
          <label htmlFor="sn">Votre nom</label>
          <input id="sn" autoComplete="name" placeholder="Moussa Dione" value={sender.senderName}
            onChange={(e) => setSender({ ...sender, senderName: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sc">Votre pays</label>
          <select id="sc" value={sender.senderCountry} onChange={(e) => setSender({ ...sender, senderCountry: e.target.value })}>
            {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sr">Adresse Lightning pour un remboursement <span className="optional">(facultatif)</span></label>
        <input id="sr" autoCapitalize="none" autoCorrect="off" placeholder="vous@blink.sv" value={sender.refundAddress}
          onChange={(e) => setSender({ ...sender, refundAddress: e.target.value.trim() })} />
      </div>
      {(error || quoteError) && <div className="alert err">{error ?? quoteError}</div>}

      <p className="note">
        Depuis un portefeuille Lightning compatible, vous pouvez aussi envoyer directement à{" "}
        <button className="inline-copy" onClick={async () => {
          await navigator.clipboard.writeText(payee.lightningAddress); setCopied(true); setTimeout(() => setCopied(false), 1500);
        }}>{payee.lightningAddress}</button>{copied && " (copiée)"}.
      </p>

      <div className="actions">
        <button className="btn" disabled={!valid || busy} onClick={pay}>
          {busy ? "Création de la facture…" : quote ? `Payer ${sats(quote.totalSats)}` : "Payer en bitcoin"}
        </button>
      </div>
    </div>
  );
}
