"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { COUNTRIES, fcfa, MAX_FCFA, MIN_FCFA, NETWORKS, postJson, sats, type Quote } from "../ui";
import NetworkLogo from "../NetworkLogo";
import { rememberTransfer } from "../store";

const SN_PHONE = /^(\+?221)?7\d{8}$/;
const clean = (p: string) => p.replace(/[\s.\-()]/g, "");
const local = (p: string) => clean(p).replace(/^\+?221/, "");
const formatPhone = (p: string) => local(p).replace(/^(\d{2})(\d{3})(\d{2})(\d{2})$/, "$1 $2 $3 $4");

type Created = { id: string; token: string };

// Écran 2 : bénéficiaire + expéditeur → récapitulatif (nouveau devis) → validation
function RecipientForm() {
  const router = useRouter();
  const amount = Number(useSearchParams().get("amount"));
  const [form, setForm] = useState({
    recipientName: "", recipientPhone: "", confirmPhone: "", recipientNetwork: "orange",
    senderName: "", senderCountry: "SN", refundAddress: "",
  });
  const [recap, setRecap] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!(amount >= MIN_FCFA && amount <= MAX_FCFA)) {
    return (
      <div className="screen">
        <h1>Montant manquant</h1>
        <p className="lede">Commencez par choisir combien envoyer.</p>
        <div className="actions"><button className="btn" onClick={() => router.push("/")}>Choisir un montant</button></div>
      </div>
    );
  }

  const update = (patch: Partial<typeof form>) => { setForm({ ...form, ...patch }); setRecap(null); };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => update({ [k]: e.target.value });

  const phoneOk = SN_PHONE.test(clean(form.recipientPhone));
  const phonesMatch = clean(form.confirmPhone) !== "" && local(form.recipientPhone) === local(form.confirmPhone);
  const valid = form.recipientName.trim().length >= 2 && phoneOk && phonesMatch && form.senderName.trim().length >= 2;
  const network = NETWORKS.find((n) => n.value === form.recipientNetwork)!;

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
        refundAddress: form.refundAddress,
      });
      rememberTransfer({ id: t.id, token: t.token, amountFcfa: amount, recipientName: form.recipientName, network: form.recipientNetwork });
      router.push(`/pay/${t.id}?token=${t.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (recap) {
    return (
      <div className="screen">
        <div className="progress" aria-label="Étape 2 sur 3"><span className="on" /><span className="on" /><span /></div>
        <h1>Vérifiez l&apos;envoi</h1>
        <p className="lede">Un envoi sur mobile money ne peut pas être annulé.</p>

        <div className="receipt">
          <div className="line"><span className="k">Bénéficiaire</span><span className="v">{form.recipientName}</span></div>
          <div className="line"><span className="k">{network.label}</span><span className="v">{formatPhone(form.recipientPhone)}</span></div>
          <div className="line"><span className="k">Expéditeur</span><span className="v">{form.senderName}</span></div>
          <div className="line"><span className="k">Reçoit</span><span className="v">{fcfa(recap.amountFcfa)}</span></div>
          <div className="line"><span className="k">Frais</span><span className="v">{fcfa(recap.feeFcfa)}</span></div>
          <div className="line total"><span className="k">À payer en bitcoin</span><span className="v sats">{sats(recap.totalSats)}</span></div>
        </div>
        {error && <div className="alert err">{error}</div>}

        <div className="actions">
          <button className="btn" disabled={busy} onClick={confirm}>{busy ? "Création de la facture…" : "Payer en bitcoin"}</button>
          <button className="btn secondary" onClick={() => setRecap(null)} disabled={busy}>Modifier</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="progress" aria-label="Étape 2 sur 3"><span className="on" /><span className="on" /><span /></div>
      <h1>À qui envoyer {fcfa(amount)}{" "}?</h1>
      <p className="lede">Le bénéficiaire a seulement besoin d&apos;un compte mobile money.</p>

      <div className="networks" role="group" aria-label="Opérateur">
        {NETWORKS.map((n) => (
          <button key={n.value} type="button" aria-pressed={form.recipientNetwork === n.value}
            onClick={() => update({ recipientNetwork: n.value })}>
            <NetworkLogo network={n.value} size={26} />{n.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="rn">Nom du bénéficiaire</label>
        <input id="rn" autoComplete="off" placeholder="Awa Diop" value={form.recipientName} onChange={set("recipientName")} />
      </div>
      <div className="field">
        <label htmlFor="rp">Numéro {network.label}</label>
        <input id="rp" inputMode="tel" placeholder="77 123 45 67" value={form.recipientPhone} onChange={set("recipientPhone")}
          aria-invalid={form.recipientPhone !== "" && !phoneOk} />
        {form.recipientPhone && !phoneOk && <p className="error-text">Entrez un numéro sénégalais à 9 chiffres commençant par 7.</p>}
      </div>
      <div className="field">
        <label htmlFor="rc">Retapez le numéro</label>
        <input id="rc" inputMode="tel" placeholder="77 123 45 67" value={form.confirmPhone} onChange={set("confirmPhone")}
          onPaste={(e) => e.preventDefault()} aria-invalid={form.confirmPhone !== "" && phoneOk && !phonesMatch} />
        {form.confirmPhone && phoneOk && !phonesMatch && <p className="error-text">Les deux numéros sont différents.</p>}
      </div>

      <p className="group-title">Vous</p>
      <div className="pair">
        <div className="field">
          <label htmlFor="sn">Votre nom</label>
          <input id="sn" autoComplete="name" placeholder="Moussa Dione" value={form.senderName} onChange={set("senderName")} />
        </div>
        <div className="field">
          <label htmlFor="sc">Votre pays</label>
          <select id="sc" value={form.senderCountry} onChange={set("senderCountry")}>
            {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sr">Adresse Lightning pour un remboursement <span className="optional">(facultatif)</span></label>
        <input id="sr" autoCapitalize="none" autoCorrect="off" placeholder="vous@blink.sv" value={form.refundAddress}
          onChange={set("refundAddress")} />
        <p className="note">Si l&apos;envoi échoue, vos sats y sont renvoyés automatiquement.</p>
      </div>
      {error && <div className="alert err">{error}</div>}

      <div className="actions">
        <button className="btn" disabled={!valid || busy} onClick={showRecap}>{busy ? "Calcul du taux…" : "Vérifier l'envoi"}</button>      </div>
    </div>
  );
}

export default function RecipientPage() {
  return <Suspense><RecipientForm /></Suspense>;
}
