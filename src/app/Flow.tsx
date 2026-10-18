// Le produit en un coup d'œil : bitcoin ailleurs → conversion → FCFA sur le mobile money.
const STEPS = [
  { icon: "₿", title: "Bitcoin", sub: "payé de n'importe quel pays" },
  { icon: "⚡", title: "Lightning", sub: "converti en quelques secondes" },
  { icon: "F", title: "FCFA", sub: "sur Orange Money, Wave…" },
];

export default function Flow() {
  return (
    <ol className="flow" aria-label="Comment ça marche">
      {STEPS.map((s, i) => (
        <li key={s.title} style={{ animationDelay: `${i * 120}ms` }}>
          <span className="flow-icon" aria-hidden>{s.icon}</span>
          <span className="flow-title">{s.title}</span>
          <span className="flow-sub">{s.sub}</span>
        </li>
      ))}
    </ol>
  );
}
