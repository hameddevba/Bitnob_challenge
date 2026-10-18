"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fcfa, MAX_FCFA, MIN_FCFA, num, postJson, sats, type Quote } from "./ui";

// Écran 1 : montant en FCFA → devis Bitnob (debounce) → bitcoin à payer
export default function AmountPage() {
  const router = useRouter();
  const [raw, setRaw] = useState("5000");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const amount = Number(raw.replace(/\D/g, ""));
  const inRange = amount >= MIN_FCFA && amount <= MAX_FCFA;

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!inRange) return;
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = await postJson<Quote>("/api/quote", { amountFcfa: amount });
        if (id === seq.current) setQuote(q);
      } catch (e) {
        if (id === seq.current) setError((e as Error).message);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [amount, inRange]);

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

      <div className="actions">
        <button className="btn" disabled={!quote} onClick={() => router.push(`/recipient?amount=${amount}`)}>
          Continuer
        </button>
      </div>
    </div>
  );
}
