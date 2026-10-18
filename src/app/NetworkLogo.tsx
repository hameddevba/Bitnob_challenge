import { NETWORKS } from "./ui";

// Badge de chaque opérateur mobile money, à ses couleurs. En petit : l'initiale ; en grand : le nom.
// (Si l'équipe dispose des logos officiels, les déposer dans public/logos/<réseau>.svg et les utiliser ici.)
export default function NetworkLogo({ network, size = 28 }: { network: string; size?: number }) {
  const n = NETWORKS.find((x) => x.value === network) ?? NETWORKS[0];
  const wordmark = size >= 44;
  const label = n.value === "orange" ? "orange" : n.value;
  return (
    <svg className="net-logo" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={n.label}>
      <rect width="48" height="48" rx="12" fill={n.color} />
      {n.value === "wave" && <path d="M6 33c5-6 9-6 13 0s8 6 12 0 8-6 11 0" stroke="#fff" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
      {wordmark ? (
        <text x={n.value === "orange" ? 6 : 24} y={n.value === "orange" ? 41 : 28} textAnchor={n.value === "orange" ? "start" : "middle"}
          fill="#fff" fontSize={label.length > 5 ? 10 : 12} fontWeight="700" fontFamily="var(--text), Arial, sans-serif" letterSpacing="-0.3">
          {label}
        </text>
      ) : (
        <text x="24" y="31" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="var(--text), Arial, sans-serif">
          {n.label[0]}
        </text>
      )}
    </svg>
  );
}

export function NetworkStrip({ size = 44 }: { size?: number }) {
  return (
    <div className="net-strip" aria-label="Réseaux mobile money pris en charge">
      {NETWORKS.map((n) => <NetworkLogo key={n.value} network={n.value} size={size} />)}
    </div>
  );
}
