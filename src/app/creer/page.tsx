"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { NETWORKS, postJson } from "../ui";

type Created = { handle: string; name: string; network: string; link: string; lightningAddress: string };

const SN_PHONE = /^(\+?221)?7\d{8}$/;
const clean = (p: string) => p.replace(/[\s.\-()]/g, "");
const local = (p: string) => clean(p).replace(/^\+?221/, "");
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 30);

// Le bénéficiaire crée son lien permanent : tout ce qui y est envoyé arrive sur son mobile money.
export default function CreateLinkPage() {
  const [form, setForm] = useState({ recipientName: "", handle: "", recipientPhone: "", confirmPhone: "", recipientNetwork: "wave" });
  const [handleEdited, setHandleEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (created) QRCode.toDataURL(created.link, { width: 480, margin: 0, color: { dark: "#14213d" } }).then(setQr);
  }, [created]);

  const network = NETWORKS.find((n) => n.value === form.recipientNetwork)!;
  const phoneOk = SN_PHONE.test(clean(form.recipientPhone));
  const phonesMatch = clean(form.confirmPhone) !== "" && local(form.recipientPhone) === local(form.confirmPhone);
  const handleOk = /^[a-z0-9][a-z0-9._-]{2,29}$/.test(form.handle);
  const valid = form.recipientName.trim().length >= 2 && handleOk && phoneOk && phonesMatch;

  function setName(v: string) {
    setForm((f) => ({ ...f, recipientName: v, handle: handleEdited ? f.handle : slug(v) }));
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      setCreated(await postJson<Created>("/api/recipients", {
        handle: form.handle, recipientName: form.recipientName,
        recipientPhone: form.recipientPhone, recipientNetwork: form.recipientNetwork,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 1500);
  }

  if (created) {
    const message = `Pour m'envoyer de l'argent sur ${network.label}, paie en bitcoin ici : ${created.link}`;
    return (
      <div className="screen">
        <h1>Votre lien est prêt</h1>
        <p className="lede">Tout ce qui est envoyé à ce lien arrive en FCFA sur votre {network.label}.</p>

        <div className="qr"><div style={{ maxWidth: 220, width: "100%" }}>{qr && <img src={qr} alt={`QR code du lien ${created.link}`} />}</div></div>

        <div className="share">
          <div className="label">Lien à partager</div>
          <div className="value">{created.link.replace(/^https?:\/\//, "")}</div>
          <div className="row-btns">
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
            <button className="btn secondary" onClick={() => copy(created.link, "link")}>{copied === "link" ? "Copié" : "Copier"}</button>
          </div>
        </div>

        <div className="share">
          <div className="label">Adresse Lightning</div>
          <div className="value">{created.lightningAddress}</div>
          <p className="note">Payable directement depuis un portefeuille Lightning. Certains portefeuilles ne la prennent pas encore en charge : le lien fonctionne partout.</p>
          <button className="btn secondary" onClick={() => copy(created.lightningAddress, "ln")}>{copied === "ln" ? "Copiée" : "Copier l'adresse"}</button>
        </div>

        <div className="actions"><a className="btn secondary" href={`/p/${created.handle}`}>Voir ma page</a></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>Recevez de l&apos;argent avec un lien</h1>
      <p className="lede">Partagez-le à vos proches : ils paient en bitcoin, vous recevez des FCFA sur votre mobile money.</p>

      <div className="networks" role="group" aria-label="Opérateur">
        {NETWORKS.map((n) => (
          <button key={n.value} type="button" aria-pressed={form.recipientNetwork === n.value}
            onClick={() => setForm({ ...form, recipientNetwork: n.value })}>
            <span className="dot" style={{ background: n.color }} />{n.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="cn">Votre nom</label>
        <input id="cn" autoComplete="name" placeholder="Awa Diop" value={form.recipientName} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ch">Votre identifiant</label>
        <div className="prefix">
          <span>/p/</span>
          <input id="ch" autoCapitalize="none" autoCorrect="off" placeholder="awa.diop" value={form.handle}
            aria-invalid={form.handle !== "" && !handleOk}
            onChange={(e) => { setHandleEdited(true); setForm({ ...form, handle: e.target.value.toLowerCase().trim() }); }} />
        </div>
        {form.handle && !handleOk && <p className="error-text">3 à 30 caractères : lettres, chiffres, point ou tiret.</p>}
      </div>
      <div className="field">
        <label htmlFor="cp">Numéro {network.label}</label>
        <input id="cp" inputMode="tel" placeholder="77 123 45 67" value={form.recipientPhone}
          aria-invalid={form.recipientPhone !== "" && !phoneOk}
          onChange={(e) => setForm({ ...form, recipientPhone: e.target.value })} />
        {form.recipientPhone && !phoneOk && <p className="error-text">Entrez un numéro sénégalais à 9 chiffres commençant par 7.</p>}
      </div>
      <div className="field">
        <label htmlFor="cc">Retapez le numéro</label>
        <input id="cc" inputMode="tel" placeholder="77 123 45 67" value={form.confirmPhone} onPaste={(e) => e.preventDefault()}
          aria-invalid={form.confirmPhone !== "" && phoneOk && !phonesMatch}
          onChange={(e) => setForm({ ...form, confirmPhone: e.target.value })} />
        {form.confirmPhone && phoneOk && !phonesMatch && <p className="error-text">Les deux numéros sont différents.</p>}
      </div>
      {error && <div className="alert err">{error}</div>}

      <div className="actions">
        <button className="btn" disabled={!valid || busy} onClick={submit}>{busy ? "Création…" : "Créer mon lien"}</button>
        <a className="text-btn" href="/">Envoyer de l&apos;argent plutôt</a>
      </div>
    </div>
  );
}
