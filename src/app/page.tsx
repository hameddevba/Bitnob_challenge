"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fcfa, MAX_FCFA, MIN_FCFA, num, sats } from "./ui";
import { useQuote } from "./useQuote";

type Mode = "send" | "receive";

// Accueil : deux usages, envoyer (montant → bénéficiaire → paiement) ou recevoir (lien, cagnotte, adresse)
export default function Home() {
  const [mode, setMode] = useState<Mode>("send");
  return (
    <div className="screen">
      <div className="switch" role="tablist" aria-label="Que voulez-vous faire ?">
        <button role="tab" aria-selected={mode === "send"} onClick={() => setMode("send")}>Envoyer</button>
        <button role="tab" aria-selected={mode === "receive"} onClick={() => setMode("receive")}>Recevoir</button>
      </div>
      {mode === "send" ? <Send /> : <Receive />}
    </div>
  );
}

function Send() {
  const router = useRouter();
  const [raw, setRaw] = useState("5000");
  const amount = Number(raw.replace(/\D/g, ""));
  const { quote, loading, error, inRange } = useQuote(amount);
  const pending = loading ? "…" : "—";

  return (
    <>
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
    </>
  );
}

const WAYS = [
  {
    title: "Votre lien de paiement",
    text: "Une page à votre nom à partager sur WhatsApp. Vos proches choisissent le montant et paient en bitcoin, vous recevez des FCFA.",
  },
  {
    title: "Des cagnottes",
    text: "Scolarité, Tabaski, santé : fixez un objectif, toute la famille contribue, chaque contribution arrive directement sur votre compte.",
  },
  {
    title: "Une adresse Lightning",
    text: "Une adresse du type awa@yonne pour recevoir depuis un portefeuille Lightning compatible.",
  },
];

function Receive() {
  return (
    <>
      <h1>Recevez de l&apos;argent de vos proches</h1>
      <p className="lede">Ils paient en bitcoin depuis n&apos;importe quel pays. Vous recevez des FCFA sur Orange Money, Wave, Free ou Expresso.</p>

      <ul className="ways">
        {WAYS.map((w) => (
          <li key={w.title}>
            <strong>{w.title}</strong>
            <span>{w.text}</span>
          </li>
        ))}
      </ul>
      <p className="note">Votre historique et vos cagnottes s&apos;ouvrent avec le lien de gestion donné à la création. Gardez-le précieusement.</p>

      <div className="actions">
        <a className="btn" href="/creer">Créer mon lien</a>
      </div>
    </>
  );
}
