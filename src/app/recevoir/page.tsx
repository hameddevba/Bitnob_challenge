"use client";

import { useEffect, useState } from "react";
import { savedSpace, type SavedSpace } from "../store";
import Flow from "../Flow";

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

// Onglet « Recevoir » : créer son lien, ou rouvrir son espace si ce téléphone le connaît déjà
export default function ReceivePage() {
  const [space, setSpace] = useState<SavedSpace | null>(null);
  useEffect(() => setSpace(savedSpace()), []);

  return (
    <div className="screen">
      <p className="eyebrow">Bitcoin ailleurs. FCFA chez vous.</p>
      <h1>Recevez des FCFA <span className="grad">depuis n&apos;importe quel pays</span></h1>
      <p className="lede">Recevez de l&apos;argent depuis n&apos;importe quel pays et retirez-le sur votre Mobile Money.</p>
      <p className="reach"><strong>Sénégal</strong> aujourd&apos;hui (Orange Money, Wave, Free, Expresso). Côte d&apos;Ivoire, Niger, Ghana, Kenya… déjà couverts par Bitnob, sans changer l&apos;architecture.</p>
      <Flow />

      {space && (
        <a className="tile" href={space.manageLink}>
          <span className="tile-title">Mon espace</span>
          <span className="tile-sub">{space.name}, historique et cagnottes</span>
          <span className="chev" aria-hidden>›</span>
        </a>
      )}

      <ul className="ways">
        {WAYS.map((w) => (
          <li key={w.title}>
            <strong>{w.title}</strong>
            <span>{w.text}</span>
          </li>
        ))}
      </ul>

      <div className="actions">
        <a className="btn" href="/creer">{space ? "Créer un autre lien" : "Créer mon lien"}</a>
      </div>
    </div>
  );
}
