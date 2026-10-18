"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRIES, fcfa, MAX_FCFA, MIN_FCFA, NETWORKS, num, postJson, sats } from "../../ui";
import { useQuote } from "../../useQuote";

type Pot = {
  slug: string; title: string; goalFcfa: number; closed: boolean;
  recipient: { handle: string; name: string; phone: string; network: string };
  progress: {
    raisedFcfa: number; contributions: number; simulated: number;
    recent: { name: string | null; amountFcfa: number; at: string; simulated: boolean }[];
  };
};

const QUICK = [5000, 10000, 25000];

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `il y a ${h} h` : new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// Cagnotte familiale : plusieurs proches contribuent, chaque contribution arrive directement sur le mobile money.
export default function PotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [pot, setPot] = useState<Pot | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [raw, setRaw] = useState("10000");
  const [form, setForm] = useState({ senderName: "", senderCountry: "FR", showSender: true, refundAddress: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(raw.replace(/\D/g, ""));
  const { quote, loading, error: quoteError, inRange } = useQuote(amount);

  // Progression rafraîchie en direct
  useEffect(() => {
    let stop = false;
    async function load() {
      const r = await fetch(`/api/pots/${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
      if (stop) return;
      if (r?.status === 404) return setNotFound(true);
      if (r?.ok) setPot(await r.json());
    }
    load();
    const t = setInterval(load, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [slug]);

  if (notFound) {
    return (
      <div className="screen">
        <h1>Cette cagnotte n&apos;existe pas</h1>
        <p className="lede">Vérifiez le lien avec la personne qui vous l&apos;a envoyé.</p>
        <div className="actions"><a className="btn secondary" href="/">Envoyer de l&apos;argent</a></div>
      </div>
    );
  }
  if (!pot) return <div className="screen"><p className="lede">Chargement de la cagnotte…</p></div>;

  const network = NETWORKS.find((n) => n.value === pot.recipient.network) ?? NETWORKS[0];
  const first = pot.recipient.name.split(" ")[0];
  const pct = Math.min(100, Math.round((pot.progress.raisedFcfa / pot.goalFcfa) * 100));
  const reached = pot.progress.raisedFcfa >= pot.goalFcfa;
  const valid = !!quote && form.senderName.trim().length >= 2 && !pot.closed;

  async function contribute() {
    setBusy(true); setError(null);
    try {
      const t = await postJson<{ id: string; token: string }>(`/api/pots/${encodeURIComponent(slug)}/contributions`, {
        amountFcfa: amount, ...form,
      });
      router.push(`/pay/${t.id}?token=${t.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <p className="pot-for">Cagnotte pour {pot.recipient.name}, reçue sur {network.label}</p>
      <h1>{pot.title}</h1>

      <div className="pot-progress" aria-live="polite">
        <p className="raised">{num(pot.progress.raisedFcfa)}<small> FCFA</small></p>
        <p className="goal">{reached ? "Objectif atteint, merci !" : `collectés sur ${fcfa(pot.goalFcfa)}`}</p>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
        <p className="note">
          {pot.progress.contributions === 0 ? "Soyez le premier à contribuer." : `${pot.progress.contributions} contribution${pot.progress.contributions > 1 ? "s" : ""}`}
          {pot.progress.simulated > 0 && ` (dont ${pot.progress.simulated} simulée${pot.progress.simulated > 1 ? "s" : ""} en sandbox)`}
        </p>
      </div>

      {pot.closed ? (
        <div className="alert warn">Cette cagnotte est clôturée.</div>
      ) : (
        <>
          <h2 className="group-title">Votre contribution</h2>
          <div className="chips" role="group" aria-label="Montants suggérés">
            {QUICK.map((v) => (
              <button key={v} type="button" aria-pressed={amount === v} onClick={() => setRaw(String(v))}>{num(v)}</button>
            ))}
          </div>
          <div className="amount compact">
            <input inputMode="numeric" aria-label="Montant en FCFA" aria-invalid={!inRange && raw !== ""}
              value={raw ? num(amount) : ""} placeholder="0"
              onChange={(e) => setRaw(e.target.value.replace(/\D/g, "").slice(0, 7))} />
            <span className="unit">FCFA</span>
          </div>
          {!inRange && raw !== "" && <p className="error-text">Choisissez un montant entre {fcfa(MIN_FCFA)} et {fcfa(MAX_FCFA)}.</p>}
          <div className="receipt">
            <div className="line"><span className="k">{first} reçoit</span><span className="v">{inRange ? fcfa(amount) : "—"}</span></div>
            <div className="line total"><span className="k">À payer en bitcoin</span><span className="v sats">{quote ? sats(quote.totalSats) : loading ? "…" : "—"}</span></div>
          </div>

          <div className="pair">
            <div className="field">
              <label htmlFor="pn">Votre nom</label>
              <input id="pn" autoComplete="name" placeholder="Tonton Ibou" value={form.senderName}
                onChange={(e) => setForm({ ...form, senderName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pc">Votre pays</label>
              <select id="pc" value={form.senderCountry} onChange={(e) => setForm({ ...form, senderCountry: e.target.value })}>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.showSender} onChange={(e) => setForm({ ...form, showSender: e.target.checked })} />
            Afficher mon nom sur la cagnotte
          </label>
          <div className="field">
            <label htmlFor="pr">Adresse Lightning pour un remboursement <span className="optional">(facultatif)</span></label>
            <input id="pr" autoCapitalize="none" autoCorrect="off" placeholder="vous@blink.sv" value={form.refundAddress}
              onChange={(e) => setForm({ ...form, refundAddress: e.target.value.trim() })} />
            <p className="note">Si l&apos;envoi vers {network.label} échoue, vos sats y sont renvoyés automatiquement.</p>
          </div>
          {(error || quoteError) && <div className="alert err">{error ?? quoteError}</div>}

          <div className="actions">
            <button className="btn" disabled={!valid || busy} onClick={contribute}>
              {busy ? "Création de la facture…" : quote ? `Contribuer ${sats(quote.totalSats)}` : "Contribuer"}
            </button>
          </div>
        </>
      )}

      {pot.progress.recent.length > 0 && (
        <>
          <h2 className="group-title">Ils ont contribué</h2>
          <ul className="contributors">
            {pot.progress.recent.map((c, i) => (
              <li key={i}>
                <span className="who">{c.name ?? "Anonyme"}</span>
                <span className="amt">{fcfa(c.amountFcfa)}</span>
                <span className="when">{ago(c.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
