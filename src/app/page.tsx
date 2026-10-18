"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fcfa, MAX_FCFA, MIN_FCFA, num, sats } from "./ui";
import { useQuote } from "./useQuote";

// Écran 1 : montant en FCFA → devis Bitnob → bitcoin à payer
export default function AmountPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("5000");
  const amount = Number(raw.replace(/\D/g, ""));
  const { quote, loading, error, inRange } = useQuote(amount);
  const pending = loading ? "…" : "—";

  return (
    <div className="screen">
      <div className="progress" aria-label="Étape 1 sur 3"><span className="on" /><span /><span /></div>
      <h1>Combien envoyer{" "}?</h1>
      <p className="lede">Le bénéficiaire reçoit exactement ce montant sur son mobile money.</p>

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
      {quote && <p className="note">1 BTC ≈ {fcfa(quote.rateBtcXof)}. Le taux est confirmé juste avant le paiement.</p>}
      {error && <div className="alert err">{error}</div>}

      <a className="aside-link" href="/creer">Vous recevez de l&apos;argent{" "}? Créez votre lien de paiement</a>

      <div className="actions">
        <button className="btn" disabled={!quote} onClick={() => router.push(`/recipient?amount=${amount}`)}>
          Continuer
        </button>
      </div>
    </div>
  );
}
