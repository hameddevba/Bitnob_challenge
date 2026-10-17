"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { COUNTRIES, fcfa, MAX_FCFA, MIN_FCFA, NETWORKS, postJson, sats, type Quote } from "../ui";

const SN_PHONE = /^(\+?221)?7\d{8}$/;
const clean = (p: string) => p.replace(/[\s.\-()]/g, "");
const formatPhone = (p: string) => clean(p).replace(/^\+?221/, "").replace(/^(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4");

type Created = { id: string; token: string };

// Écran 2 : bénéficiaire + expéditeur → récapitulatif (nouveau devis) → validation
function RecipientForm() {
  const router = useRouter();
  const amount = Number(useSearchParams().get("amount"));
  const [form, setForm] = useState({
    recipientName: "", recipientPhone: "", confirmPhone: "", recipientNetwork: "orange",
    senderName: "", senderCountry: "SN",
  });
  const [recap, setRecap] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!(amount >= MIN_FCFA && amount <= MAX_FCFA)) {
    return (
      <section className="card">
        <h1>Montant manquant</h1>
        <button className="btn" onClick={() => router.push("/")}>Saisir un montant</button>
      </section>
    );
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setRecap(null);
  };
  const phoneOk = SN_PHONE.test(clean(form.recipientPhone));
  const phonesMatch = clean(form.confirmPhone) !== "" &&
    clean(form.recipientPhone).replace(/^\+?221/, "") === clean(form.confirmPhone).replace(/^\+?221/, "");
  const valid = form.recipientName.trim().length >= 2 && phoneOk && phonesMatch && form.senderName.trim().length >= 2;
  const networkLabel = NETWORKS.find((n) => n.value === form.recipientNetwork)?.label;

  async function showRecap() {
    setBusy(true); setError(null);
    try {
      setRecap(await postJson<Quote>("/api/quote", { amountFcfa: amount }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const t = await postJson<Created>("/api/transfers", {
        amountFcfa: amount,
        recipientName: form.recipientName,
        recipientPhone: form.recipientPhone,
        recipientNetwork: form.recipientNetwork,
        senderName: form.senderName,
        senderCountry: form.senderCountry,
      });
      router.push(`/pay/${t.id}?token=${t.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (recap) {
    return (
      <>
        <div className="steps"><span className="on" /><span className="on" /><span /></div>
        <section className="card">
          <h1>Vérifiez avant de payer</h1>
          <p className="sub">Un envoi mobile money ne peut pas être annulé.</p>
          <div className="row"><span className="k">Bénéficiaire</span><span className="v">{form.recipientName}</span></div>
          <div className="row"><span className="k">Numéro {networkLabel}</span><span className="v">{formatPhone(form.recipientPhone)}</span></div>
          <div className="row"><span className="k">Expéditeur</span><span className="v">{form.senderName}</span></div>
          <div className="quote">
            <div className="row"><span className="k">Reçoit</span><span className="v">{fcfa(recap.amountFcfa)}</span></div>
            <div className="row"><span className="k">Frais de service</span><span className="v">{fcfa(recap.feeFcfa)}</span></div>
            <div className="row total"><span className="k">Vous payez</span><span className="v sats">{sats(recap.totalSats)}</span></div>
            <p className="hint">Montant définitif fixé à la validation. Paiement en Bitcoin Lightning.</p>
          </div>
          {error && <div className="alert err">{error}</div>}
          <button className="btn" disabled={busy} onClick={confirm}>{busy ? "Création de la facture…" : "Valider et payer"}</button>
          <button className="link" onClick={() => setRecap(null)} disabled={busy}>Modifier</button>
        </section>
      </>
    );
  }

  return (
    <>
      <div className="steps"><span className="on" /><span className="on" /><span /></div>
      <section className="card">
        <h1>À qui envoyez-vous {fcfa(amount)} ?</h1>
        <p className="sub">Le bénéficiaire n&apos;a besoin que de son compte mobile money.</p>

        <label>Réseau</label>
        <div className="networks">
          {NETWORKS.map((n) => (
            <button key={n.value} type="button" className={form.recipientNetwork === n.value ? "on" : ""}
              onClick={() => { setForm({ ...form, recipientNetwork: n.value }); setRecap(null); }}>
              {n.label}
            </button>
          ))}
        </div>

        <label htmlFor="rn">Nom du bénéficiaire</label>
        <input id="rn" autoComplete="off" placeholder="ex. Awa Diop" value={form.recipientName} onChange={set("recipientName")} />

        <label htmlFor="rp">Numéro {networkLabel} Money</label>
        <input id="rp" inputMode="tel" placeholder="77 123 45 67" value={form.recipientPhone} onChange={set("recipientPhone")} />
        {form.recipientPhone && !phoneOk && <div className="field-err">Numéro sénégalais à 9 chiffres commençant par 7.</div>}

        <label htmlFor="rc">Confirmez le numéro</label>
        <input id="rc" inputMode="tel" placeholder="77 123 45 67" value={form.confirmPhone} onChange={set("confirmPhone")}
          onPaste={(e) => e.preventDefault()} />
        {form.confirmPhone && phoneOk && !phonesMatch && <div className="field-err">Les deux numéros ne correspondent pas.</div>}

        <div className="grid2">
          <div>
            <label htmlFor="sn">Votre nom</label>
            <input id="sn" autoComplete="name" placeholder="ex. Moussa Dione" value={form.senderName} onChange={set("senderName")} />
          </div>
          <div>
            <label htmlFor="sc">Votre pays</label>
            <select id="sc" value={form.senderCountry} onChange={set("senderCountry")}>
              {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="alert err">{error}</div>}
        <button className="btn" disabled={!valid || busy} onClick={showRecap}>{busy ? "Calcul…" : "Voir le récapitulatif"}</button>
        <button className="link" onClick={() => router.push("/")}>Changer le montant</button>
      </section>
    </>
  );
}

export default function RecipientPage() {
  return <Suspense><RecipientForm /></Suspense>;
}
