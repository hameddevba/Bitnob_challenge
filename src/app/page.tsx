"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CLASSIC_FEE_PERCENT, classicFee, fcfa, MAX_FCFA, MIN_FCFA, NETWORKS, num, sats } from "./ui";
import NetworkLogo from "./NetworkLogo";
import { useQuote } from "./useQuote";
import Flow from "./Flow";

// Onglet « Envoyer » : montant en FCFA → bénéficiaire → paiement
export default function SendPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("5000");
  const amount = Number(raw.replace(/\D/g, ""));
  const { quote, loading, error, inRange } = useQuote(amount);
  const pending = loading ? "…" : "—";

  return (
    <div className="screen">
      <p className="eyebrow">Vous payez en bitcoin · ils reçoivent des FCFA</p>
      <h1>Combien <span className="grad">envoyer</span>{" "}?</h1>
      <div className="lede-row">
        <span>Reçu en quelques secondes sur</span>
        <span className="mini-logos">
          {NETWORKS.map((n) => <NetworkLogo key={n.value} network={n.value} size={22} />)}
        </span>
      </div>
      <Flow />

      <div className="amount">
        <input
          inputMode="numeric"
          aria-label="Montant en FCFA"
          aria-invalid={!inRange && raw !== ""}
          value={raw ? num(amount) : ""}
          placeholder="0"
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 7))}
        />
        <span className="unit">FCFA</span>
      </div>
      {!inRange && raw !== "" && <p className="error-text">Choisissez un montant entre {fcfa(MIN_FCFA)} et {fcfa(MAX_FCFA)}.</p>}

      <div className="receipt" aria-live="polite">
        <div className="line"><span className="k">Frais</span><span className="v">{quote ? fcfa(quote.feeFcfa) : pending}</span></div>
        <div className="line total"><span className="k">À payer en bitcoin</span><span className="v sats">{quote ? sats(quote.totalSats) : pending}</span></div>
      </div>
      {quote && classicFee(amount) > quote.feeFcfa && (
        <div className="saving">
          <span>Vous économisez</span>
          <strong>{fcfa(classicFee(amount) - quote.feeFcfa)}</strong>
          <small>par rapport à un transfert classique (~{CLASSIC_FEE_PERCENT} % de frais en moyenne vers l'Afrique, Banque mondiale)</small>
        </div>
      )}
      {quote && <p className="note">1 BTC ≈ {fcfa(quote.rateBtcXof)}. Le taux est confirmé juste avant le paiement.</p>}
      {error && <div className="alert err">{error}</div>}

      <div className="actions">
        <button className="btn" disabled={!quote} onClick={() => router.push(`/recipient?amount=${amount}`)}>
          Continuer
        </button>
      </div>
    </div>
  );
}
