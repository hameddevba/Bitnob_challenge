"use client";

import { useEffect, useState } from "react";
import { savedSpace, type SavedSpace } from "../store";

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
      <h1>Recevez de l&apos;argent de <span className="grad">vos proches</span></h1>
      <p className="lede">Ils paient en bitcoin depuis n&apos;importe quel pays. Vous recevez des FCFA sur Orange Money, Wave, Free ou Expresso.</p>

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
