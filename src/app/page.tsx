"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fcfa, MAX_FCFA, MIN_FCFA, postJson, sats, type Quote } from "./ui";

// Écran 1 : montant en FCFA → devis Bitnob (debounce) → BTC à payer
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
    }, 600);
    return () => clearTimeout(t);
  }, [amount, inRange]);

  return (
    <>
      <div className="steps"><span className="on" /><span /><span /></div>
      <section className="card">
        <h1>Combien voulez-vous envoyer ?</h1>
        <p className="sub">Le bénéficiaire reçoit exactement ce montant sur son mobile money.</p>

        <div className="amount-input">
          <input
            inputMode="numeric"
            aria-label="Montant en FCFA"
            value={raw ? new Intl.NumberFormat("fr-FR").format(amount) : ""}
            onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 7))}
          />
          <span className="suffix">FCFA</span>
        </div>
        {!inRange && raw !== "" && (
          <div className="field-err">Entre {fcfa(MIN_FCFA)} et {fcfa(MAX_FCFA)}.</div>
        )}

        <div className="quote" aria-live="polite">
          <div className="row"><span className="k">Le bénéficiaire reçoit</span><span className="v">{inRange ? fcfa(amount) : "—"}</span></div>
          <div className="row"><span className="k">Frais de service</span><span className="v">{quote ? fcfa(quote.feeFcfa) : loading ? "…" : "—"}</span></div>
          <div className="row total"><span className="k">Vous payez</span><span className="v sats">{quote ? sats(quote.totalSats) : loading ? "Calcul…" : "—"}</span></div>
          {quote && <p className="hint">1 BTC ≈ {fcfa(quote.rateBtcXof)} · taux Bitnob, recalculé à la validation</p>}
        </div>

        {error && <div className="alert err">{error}</div>}

        <button className="btn" disabled={!quote} onClick={() => router.push(`/recipient?amount=${amount}`)}>
          Continuer
        </button>
      </section>
    </>
  );
}
