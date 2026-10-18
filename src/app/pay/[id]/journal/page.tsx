"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fcfa, sats } from "../../../ui";

type Event = { id: number; source: string; type: string; at: string; title: string; detail?: string; tone: "info" | "ok" | "err"; payload: unknown };
type Journal = { transfer: { id: string; status: string; amountFcfa: number; totalSats: number; createdAt: string }; events: Event[] };

const TERMINAL = ["PAYOUT_SUCCESS", "EXPIRED", "CANCELLED", "REFUNDED"];
const SOURCE: Record<string, string> = { bitnob: "Bitnob", system: "Yónne", user: "Utilisateur" };

function elapsed(from: string, to: string) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms < 60_000 ? `+${(ms / 1000).toFixed(1).replace(".", ",")} s` : `+${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

// « Sous le capot » : chronologie technique d'un envoi, lue dans le journal d'audit
function JournalView({ id }: { id: string }) {
  const token = useSearchParams().get("token") ?? "";
  const [j, setJ] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const r = await fetch(`/api/transfers/${id}/events?token=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (!r?.ok) return setError("Journal introuvable. Vérifiez le lien.");
      const data = (await r.json()) as Journal;
      setJ(data);
      if (!TERMINAL.includes(data.transfer.status)) timer = setTimeout(load, 3000);
    }
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, token]);

  const back = `/pay/${id}?token=${encodeURIComponent(token)}`;
  if (error) return <div className="screen"><h1>Journal indisponible</h1><div className="alert err">{error}</div><nav className="nav-links"><a href={back}>Retour à l&apos;envoi</a><a href="/">Accueil</a></nav></div>;
  if (!j) return <div className="screen"><p className="lede">Chargement du journal…</p></div>;

  return (
    <div className="screen">
      <h1>Sous le capot</h1>
      <p className="lede">{fcfa(j.transfer.amountFcfa)} pour {sats(j.transfer.totalSats)}. Chaque étape est enregistrée dans un journal d&apos;audit qui ne peut pas être modifié.</p>

      <ol className="journal">
        {j.events.map((e) => (
          <li key={e.id} className={e.tone}>
            <div className="j-head">
              <span className="j-title">{e.title}</span>
              <span className="j-time">{elapsed(j.transfer.createdAt, e.at)}</span>
            </div>
            {e.detail && <p className="j-detail">{e.detail}</p>}
            <details>
              <summary>{SOURCE[e.source] ?? e.source}, donnée brute</summary>
              <pre>{JSON.stringify(e.payload, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ol>
      {!TERMINAL.includes(j.transfer.status) && <p className="note">Mise à jour automatique en cours…</p>}

      <nav className="nav-links" aria-label="Navigation">
        <a href={back}>Retour à l&apos;envoi</a>
        <a href="/">Faire un nouvel envoi</a>
      </nav>
    </div>
  );
}

export default function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><JournalView id={id} /></Suspense>;
}
