import Flow from "./Flow";
import { NetworkStrip } from "./NetworkLogo";
import { CLASSIC_FEE_PERCENT } from "./ui";

// Colonne de présentation, visible seulement sur grand écran (à gauche de l'application).
export default function Hero() {
  return (
    <aside className="hero" aria-label="Présentation de Yónne">
      <p className="eyebrow">Bitcoin ailleurs. FCFA chez vous.</p>
      <h2 className="hero-title">
        Recevez des FCFA <span className="grad">depuis n&apos;importe quel pays</span>, retirez-les sur votre Mobile Money.
      </h2>
      <p className="hero-lede">
        La diaspora paie en bitcoin Lightning, la famille reçoit des FCFA en quelques secondes,
        sans jamais toucher au bitcoin. Propulsé par l&apos;API Bitnob.
      </p>

      <Flow />

      <p className="hero-label">Retrait sur</p>
      <NetworkStrip size={48} />

      <dl className="stats">
        <div><dt>1,5 %</dt><dd>de frais, contre ~{CLASSIC_FEE_PERCENT} % en moyenne</dd></div>
        <div><dt>⚡</dt><dd>paiement Lightning confirmé en quelques secondes</dd></div>
        <div><dt>5+ pays</dt><dd>Sénégal aujourd&apos;hui, extensible via Bitnob</dd></div>
      </dl>
    </aside>
  );
}
