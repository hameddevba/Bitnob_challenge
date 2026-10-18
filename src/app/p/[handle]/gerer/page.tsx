"use client";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fcfa, NETWORKS, num } from "../../../ui";

type Dashboard = {
  recipient: { handle: string; name: string; phone: string; network: string; link: string; lightningAddress: string };
  totals: { receivedFcfa: number; delivered: number; inProgress: number };
  transfers: {
    id: string; status: string; amountFcfa: number; senderName: string; senderCountry: string;
    origin: string; potTitle: string | null; simulated: boolean; at: string;
  }[];
  pots: { slug: string; title: string; goalFcfa: number; link: string; progress: { raisedFcfa: number; contributions: number } }[];
};

const STATUS: Record<string, { label: string; tone: "ok" | "wait" | "err" }> = {
  PAYOUT_SUCCESS: { label: "Reçu", tone: "ok" },
  PAYOUT_PENDING: { label: "En cours", tone: "wait" },
  PAYOUT_PROCESSING: { label: "En cours", tone: "wait" },
  PAYMENT_DETECTED: { label: "En cours", tone: "wait" },
  PAYOUT_FAILED: { label: "Nouvel essai", tone: "wait" },
  REFUND_PENDING: { label: "Remboursement", tone: "err" },
  REFUNDED: { label: "Remboursé", tone: "err" },
  UNDERPAID: { label: "En vérification", tone: "err" },
};

const day = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Espace du bénéficiaire : accessible uniquement avec le lien de gestion secret (?k=…)
function Manage({ handle }: { handle: string }) {
  const key = useSearchParams().get("k") ?? "";
  const [data, setData] = useState<Dashboard | null>(null);
  const [denied, setDenied] = useState(false);
  const [pot, setPot] = useState({ title: "", goal: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/recipients/${encodeURIComponent(handle)}/dashboard`, { headers: { "x-owner-token": key }, cache: "no-store" });
    if (r.status === 403) return setDenied(true);
    if (r.ok) setData(await r.json());
  }, [handle, key]);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  if (denied) {
    return (
      <div className="screen">
        <h1>Accès réservé</h1>
        <p className="lede">Cet espace s&apos;ouvre uniquement avec le lien de gestion reçu à la création de votre lien.</p>
        <div className="actions"><a className="btn secondary" href={`/p/${handle}`}>Voir la page publique</a></div>
      </div>
    );
  }
  if (!data) return <div className="screen"><p className="lede">Chargement de votre espace…</p></div>;

  const network = NETWORKS.find((n) => n.value === data.recipient.network) ?? NETWORKS[0];
  const goal = Number(pot.goal.replace(/\D/g, ""));
  const potValid = pot.title.trim().length >= 3 && goal >= 500;

  async function createPot() {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/recipients/${encodeURIComponent(handle)}/pots`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-owner-token": key },
        body: JSON.stringify({ title: pot.title.trim(), goalFcfa: goal }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
      setPot({ title: "", goal: "" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id); setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="screen">
      <p className="pot-for">Espace de {data.recipient.name}, {network.label} {data.recipient.phone}</p>
      <div className="pot-progress" style={{ marginTop: 6 }}>
        <p className="raised">{num(data.totals.receivedFcfa)}<small> FCFA</small></p>
        <p className="goal">
          reçus en {data.totals.delivered} envoi{data.totals.delivered > 1 ? "s" : ""}
          {data.totals.inProgress > 0 && `, ${data.totals.inProgress} en cours`}
        </p>
      </div>

      <div className="row-btns" style={{ marginTop: 18 }}>
        <button className="btn secondary" onClick={() => copy(data.recipient.link, "link")}>{copied === "link" ? "Lien copié" : "Copier mon lien"}</button>
        <a className="btn secondary" href={data.recipient.link}>Ma page</a>
      </div>

      <h2 className="group-title">Mes cagnottes</h2>
      {data.pots.length === 0 && <p className="note">Une cagnotte réunit plusieurs proches autour d&apos;un objectif : scolarité, Tabaski, santé…</p>}
      <ul className="pots">
        {data.pots.map((p) => {
          const pct = Math.min(100, Math.round((p.progress.raisedFcfa / p.goalFcfa) * 100));
          return (
            <li key={p.slug}>
              <div className="pot-head">
                <a href={p.link} className="pot-title">{p.title}</a>
                <button className="inline-copy" onClick={() => copy(p.link, p.slug)}>{copied === p.slug ? "Copié" : "Copier le lien"}</button>
              </div>
              <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              <p className="note">{fcfa(p.progress.raisedFcfa)} sur {fcfa(p.goalFcfa)}, {p.progress.contributions} contribution{p.progress.contributions > 1 ? "s" : ""}</p>
            </li>
          );
        })}
      </ul>

      <div className="new-pot">
        <div className="field">
          <label htmlFor="pt">Nouvelle cagnotte</label>
          <input id="pt" placeholder="Frais de scolarité" maxLength={80} value={pot.title} onChange={(e) => setPot({ ...pot, title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pg">Objectif en FCFA</label>
          <input id="pg" inputMode="numeric" placeholder="150 000" value={pot.goal ? num(goal) : ""}
            onChange={(e) => setPot({ ...pot, goal: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
        </div>
        {error && <div className="alert err">{error}</div>}
        <button className="btn" style={{ marginTop: 14 }} disabled={!potValid || busy} onClick={createPot}>{busy ? "Création…" : "Créer la cagnotte"}</button>
      </div>

      <h2 className="group-title">Envois reçus</h2>
      {data.transfers.length === 0 ? (
        <p className="note">Aucun envoi pour l&apos;instant. Partagez votre lien pour recevoir de l&apos;argent.</p>
      ) : (
        <ul className="history">
          {data.transfers.map((t) => {
            const s = STATUS[t.status] ?? { label: t.status, tone: "wait" as const };
            return (
              <li key={t.id}>
                <div>
                  <div className="who">{t.senderName}</div>
                  <div className="when">{day(t.at)}{t.potTitle ? `, ${t.potTitle}` : t.origin === "lightning_address" ? ", adresse Lightning" : ""}{t.simulated ? " (simulé)" : ""}</div>
                </div>
                <div className="right">
                  <div className="amt">{fcfa(t.amountFcfa)}</div>
                  <span className={`tag ${s.tone}`}>{s.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ManagePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  return <Suspense><Manage handle={handle} /></Suspense>;
}
