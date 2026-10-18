# Next.js côté serveur (Server Actions + Server Components)

Ce guide **remplace le §3.6, §3.7 et §5 de `NEXTJS-SANS-CLI.md`** (routes `/api/quote`, `/api/transfers` et front qui appelle `fetch` avec un token).
Tout le reste est conservé : SQL, `lib/server/bitnob.ts`, `paydunya.ts`, `pricing.ts`, `transfers.ts`, `/api/worker`, `/api/paydunya/callback`, pg_cron.

## 0. Principe

| Élément | Avant | Maintenant |
|---|---|---|
| Devis, création du transfert | Route Handlers + `fetch` + Bearer token côté navigateur | **Server Actions** (`"use server"`) |
| Authentification | Token JWT passé par le navigateur | **Cookies de session** lus côté serveur (`@supabase/ssr`) |
| Page de suivi | Realtime côté navigateur | **Server Component** qui lit la base ; rafraîchi par `router.refresh()` |
| Clé `service_role`, Bitnob, PayDunya | serveur | serveur (inchangé, protégé par `server-only`) |
| `/api/worker`, `/api/paydunya/callback` | Route Handlers | **Restent des Route Handlers** : ce sont des endpoints HTTP appelés par pg_cron et PayDunya, une Server Action ne convient pas |

Avantages : aucun secret ni token manipulé côté navigateur, plus besoin de `transfers_public` ni de Realtime, moins de code client.

> Les Server Actions sont des endpoints POST publics : **chaque action revérifie l'utilisateur** (§3).

---

## 1. Dépendances et versions

```bash
npm i @supabase/ssr @supabase/supabase-js server-only qrcode.react
```

- Les exemples ciblent Next.js 15+ (`await cookies()`). Sur Next 14, retirez simplement le `await`.
- À partir de Next.js 16, `middleware.ts` est renommé `proxy.ts` (fonction exportée `proxy`). Vérifiez votre version et adaptez le nom du fichier au §2.3.

Ajoutez `import "server-only";` en première ligne de **chaque** fichier de `lib/server/*` : le build échouera si l'un d'eux est importé par erreur dans un composant client.

---

## 2. Authentification par cookies

### 2.1 `lib/supabase/server.ts` : client lié à l'utilisateur connecté

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
          catch { /* appelé depuis un Server Component : ignoré, le middleware rafraîchit la session */ }
        },
      },
    },
  );
}

/** Utilisateur authentifié (validé auprès de Supabase, pas seulement lu dans le cookie) */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
```

### 2.2 `lib/server/supabase.ts` : on garde seulement le client admin

Supprimez `getUser(req)` basé sur le Bearer token ; gardez `admin` et `json` (utilisés par le worker et le callback) :

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
```

### 2.3 `middleware.ts` (racine du projet, à côté de `app/`) : rafraîchit la session

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Pages protégées
  const p = req.nextUrl.pathname;
  if (!user && (p.startsWith("/send") || p.startsWith("/transfers"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Exclut les endpoints machine-à-machine : worker et callback PayDunya ne doivent jamais être redirigés
  matcher: ["/((?!api/worker|api/paydunya|_next/static|_next/image|favicon.ico).*)"],
};
```

### 2.4 Connexion minimale (Server Actions)

`app/login/actions.ts`

```ts
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(_: unknown, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) return { error: "Identifiants invalides" };
  redirect("/send");
}

export async function signup(_: unknown, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  if (error) return { error: error.message };
  redirect("/send");   // si la confirmation e-mail est activée dans Supabase, l'utilisateur devra d'abord confirmer
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

`app/login/page.tsx`

```tsx
"use client";
import { useActionState } from "react";
import { login, signup } from "./actions";

export default function LoginPage() {
  const [loginState, loginAction, loginPending] = useActionState(login, null);
  const [signupState, signupAction, signupPending] = useActionState(signup, null);
  const error = (loginState as any)?.error ?? (signupState as any)?.error;

  return (
    <form className="mx-auto max-w-sm space-y-3 p-4">
      <input name="email" type="email" required placeholder="E-mail" className="w-full rounded border p-3" />
      <input name="password" type="password" required minLength={8} placeholder="Mot de passe" className="w-full rounded border p-3" />
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button formAction={loginAction} disabled={loginPending} className="w-full rounded bg-black p-3 text-white">Se connecter</button>
      <button formAction={signupAction} disabled={signupPending} className="w-full p-2 underline">Créer un compte</button>
    </form>
  );
}
```

(Vous pouvez remplacer par OTP e-mail ou téléphone : seule cette partie change.)

---

## 3. Services serveur + Server Actions

### 3.1 `lib/server/services.ts` : la logique métier (réutilise le code des anciennes routes)

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { admin } from "./supabase";
import { computeQuote } from "./pricing";
import { createInvoice } from "./bitnob";
import { ORANGE_MODE, PHONE_RULES } from "./paydunya";

/** Erreur dont le message peut être affiché à l'utilisateur */
export class UserError extends Error {}

export async function createQuote(userId: string, amountXof: number) {
  const q = await computeQuote(amountXof);                       // lève une Error lisible (limites, entier…)
  const expiresAt = new Date(Date.now() + q.quoteTtl * 1000).toISOString();

  const { data, error } = await admin.from("quotes").insert({
    user_id: userId, amount_xof: q.amountXof, fee_xof: q.feeXof, total_xof: q.totalXof,
    xof_per_btc: q.rate, amount_sats: q.amountSats, expires_at: expiresAt,
  }).select().single();
  if (error) throw error;

  return {
    quote_id: data.id as string,
    amount_xof: data.amount_xof as number,
    fee_xof: data.fee_xof as number,
    total_xof: data.total_xof as number,
    amount_sats: Number(data.amount_sats),
    amount_btc: (Number(data.amount_sats) / 1e8).toFixed(8),
    expires_at: data.expires_at as string,
  };
}

export async function createTransfer(userId: string, input: {
  quoteId: string; name: string; country: string; phone: string;
}) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new UserError("Nom invalide");

  const country = input.country.toUpperCase();
  if (!ORANGE_MODE[country]) throw new UserError("Pays non supporté");

  const phone = input.phone.replace(/\D/g, "");
  if (!PHONE_RULES[country].test(phone)) throw new UserError("Numéro Orange Money invalide");

  const { data: quote } = await admin.from("quotes").select("*")
    .eq("id", input.quoteId).eq("user_id", userId).maybeSingle();
  if (!quote) throw new UserError("Devis introuvable");
  if (quote.used_at) throw new UserError("Devis déjà utilisé");
  if (new Date(quote.expires_at) < new Date()) throw new UserError("Devis expiré, recommencez");

  // Consommation atomique du devis (anti double-clic / rejeu)
  const { data: claimed } = await admin.from("quotes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", quote.id).is("used_at", null).select("id").maybeSingle();
  if (!claimed) throw new UserError("Devis déjà utilisé");

  const transferId = randomUUID();
  const secondsLeft = Math.max(60, Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000));

  const inv = await createInvoice({
    amountSats: Number(quote.amount_sats),
    description: `Envoi ${quote.amount_xof} FCFA`,
    reference: `tx-${transferId}`,
    expirySeconds: secondsLeft,
  });

  const { error } = await admin.from("transfers").insert({
    id: transferId, user_id: userId, quote_id: quote.id,
    amount_xof: quote.amount_xof, fee_xof: quote.fee_xof, total_xof: quote.total_xof,
    amount_sats: quote.amount_sats, xof_per_btc: quote.xof_per_btc,
    recipient_name: name, recipient_country: country, recipient_phone: phone,
    withdraw_mode: ORANGE_MODE[country],
    bitnob_invoice_id: inv.id, bitnob_reference: `tx-${transferId}`,
    payment_hash: inv.payment_hash, bolt11: inv.request,
    invoice_expires_at: new Date(Date.now() + secondsLeft * 1000).toISOString(),
  });
  if (error) throw error;

  await admin.from("transfer_events").insert({
    transfer_id: transferId, to_status: "awaiting_payment", note: "Facture Lightning créée",
  });

  return transferId;
}
```

### 3.2 `app/send/actions.ts` : les Server Actions

```ts
"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createQuote, createTransfer, UserError } from "@/lib/server/services";

export type QuoteResult =
  | { ok: true; quote: Awaited<ReturnType<typeof createQuote>> }
  | { ok: false; error: string };

/** Étape 1 : montant → devis */
export async function quoteAction(amountXof: number): Promise<QuoteResult> {
  const user = await requireUser();                      // toujours revérifier
  if (!user) return { ok: false, error: "Session expirée, reconnectez-vous" };

  try {
    return { ok: true, quote: await createQuote(user.id, Number(amountXof)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };   // messages de limites : sans danger
  }
}

/** Étape 3 : validation → facture Lightning, puis redirection vers la page de suivi */
export async function createTransferAction(input: {
  quoteId: string; name: string; country: string; phone: string;
}): Promise<{ ok: false; error: string }> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "Session expirée, reconnectez-vous" };

  let id: string;
  try {
    id = await createTransfer(user.id, input);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("createTransfer", e);
    return { ok: false, error: "Impossible de créer le transfert" };   // détail interne jamais exposé
  }
  redirect(`/transfers/${id}`);          // hors try/catch : redirect() lève une exception de contrôle
}
```

---

## 4. Pages

### 4.1 `app/send/page.tsx` : Server Component

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import SendWizard from "./SendWizard";

export default async function SendPage() {
  if (!(await requireUser())) redirect("/login");
  return <SendWizard />;
}
```

### 4.2 `app/send/SendWizard.tsx` : composant client minimal (étapes 1 à 3)

Seul l'état de formulaire reste côté navigateur ; les calculs et appels API sont dans les Server Actions.

```tsx
"use client";
import { useState, useTransition } from "react";
import { quoteAction, createTransferAction, type QuoteResult } from "./actions";

type Quote = Extract<QuoteResult, { ok: true }>["quote"];

export default function SendWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("SN");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const getQuote = () => start(async () => {
    setError(null);
    const r = await quoteAction(Number(amount));
    if (!r.ok) return setError(r.error);
    setQuote(r.quote); setStep(2);
  });

  const validate = () => start(async () => {
    if (!quote) return;
    setError(null);
    const r = await createTransferAction({ quoteId: quote.quote_id, name, country, phone });
    if (r && !r.ok) setError(r.error);          // en cas de succès, redirect() quitte la page
  });

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      {error && <p role="alert" className="rounded bg-red-100 p-2 text-red-700">{error}</p>}

      {step === 1 && (<>
        <label>Montant à envoyer (FCFA)</label>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
               className="w-full rounded border p-3 text-2xl" placeholder="50000" />
        <button disabled={!amount || pending} onClick={getQuote} className="w-full rounded bg-black p-3 text-white">
          Continuer
        </button>
      </>)}

      {step === 2 && quote && (<>
        <Summary q={quote} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du destinataire" className="w-full rounded border p-3" />
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded border p-3">
          <option value="SN">Sénégal</option><option value="CI">Côte d'Ivoire</option>
          <option value="ML">Mali</option><option value="BF">Burkina Faso</option>
        </select>
        <input inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
               placeholder="N° Orange Money (sans indicatif)" className="w-full rounded border p-3" />
        <button disabled={!name || !phone} onClick={() => setStep(3)} className="w-full rounded bg-black p-3 text-white">
          Vérifier
        </button>
      </>)}

      {step === 3 && quote && (<>
        <Summary q={quote} />
        <div className="rounded border p-3">
          <p><b>{name}</b></p>
          <p>Orange Money · {country} · {phone}</p>
          <p className="mt-2 text-sm text-gray-600">Vérifiez le numéro : un envoi vers un mauvais numéro ne peut pas être annulé.</p>
        </div>
        <button disabled={pending} onClick={validate} className="w-full rounded bg-green-600 p-3 text-white">
          {pending ? "Création de la facture…" : "Valider et payer en Bitcoin"}
        </button>
        <button onClick={() => setStep(2)} className="w-full p-2 underline">Modifier</button>
      </>)}
    </div>
  );
}

function Summary({ q }: { q: Quote }) {
  return (
    <div className="rounded border p-3">
      <p>Le destinataire reçoit : <b>{q.amount_xof.toLocaleString("fr-FR")} FCFA</b></p>
      <p>Frais : {q.fee_xof.toLocaleString("fr-FR")} FCFA</p>
      <p>Total : {q.total_xof.toLocaleString("fr-FR")} FCFA</p>
      <p className="font-mono">≈ {q.amount_btc} BTC ({q.amount_sats.toLocaleString("fr-FR")} sats)</p>
    </div>
  );
}
```

### 4.3 `app/transfers/[id]/page.tsx` : suivi, 100 % Server Component

La requête passe par le client **de l'utilisateur** : la RLS garantit qu'il ne lit que ses propres transferts, et on sélectionne explicitement des colonnes sûres (jamais `preimage` ni `disburse_token`).

```tsx
import { notFound, redirect } from "next/navigation";
import { createClient, requireUser } from "@/lib/supabase/server";
import AutoRefresh from "./AutoRefresh";
import PayQr from "./PayQr";

export const dynamic = "force-dynamic";

const FINAL = ["completed", "expired", "refunded"];

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await requireUser())) redirect("/login");

  const supabase = await createClient();
  const { data: t } = await supabase.from("transfers")
    .select("id,status,amount_xof,fee_xof,total_xof,amount_sats,recipient_name,bolt11,invoice_expires_at,completed_at")
    .eq("id", id).maybeSingle();
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 text-center">
      {!FINAL.includes(t.status) && <AutoRefresh everyMs={t.status === "awaiting_payment" ? 4000 : 5000} />}

      {t.status === "awaiting_payment" && (
        <PayQr bolt11={t.bolt11} sats={Number(t.amount_sats)} expiresAt={t.invoice_expires_at} />
      )}

      {["btc_received", "payout_created", "payout_pending"].includes(t.status) && (
        <p className="text-lg">⚡ Bitcoin reçu, envoi de {t.amount_xof.toLocaleString("fr-FR")} FCFA à {t.recipient_name} en cours…</p>
      )}

      {t.status === "completed" && (
        <p className="text-xl">✅ Envoyé ! {t.recipient_name} a reçu {t.amount_xof.toLocaleString("fr-FR")} FCFA.</p>
      )}

      {t.status === "expired" && <p>⌛ Facture expirée. Recommencez un nouveau transfert.</p>}

      {["payout_failed", "refund_required", "refunded"].includes(t.status) && (
        <p>⚠️ L'envoi FCFA a échoué. Votre paiement Bitcoin sera remboursé : contactez le support en indiquant la référence {t.id}.</p>
      )}
    </div>
  );
}
```

### 4.4 `app/transfers/[id]/AutoRefresh.tsx` : relit la page serveur à intervalle

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const i = setInterval(() => router.refresh(), everyMs);   // re-exécute le Server Component, sans rechargement complet
    return () => clearInterval(i);
  }, [router, everyMs]);
  return null;
}
```

### 4.5 `app/transfers/[id]/PayQr.tsx` : QR + compte à rebours (affichage seulement)

```tsx
"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export default function PayQr({ bolt11, sats, expiresAt }: { bolt11: string; sats: number; expiresAt: string }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i);
  }, [expiresAt]);

  return (
    <div className="space-y-3">
      <p>Scannez avec votre wallet Lightning</p>
      <div className="inline-block rounded bg-white p-3">
        <QRCodeSVG value={`lightning:${bolt11}`} size={240} />
      </div>
      <p className="font-mono text-sm">{sats.toLocaleString("fr-FR")} sats</p>
      <p>Expire dans {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      <button onClick={() => navigator.clipboard.writeText(bolt11)} className="underline">Copier la facture</button>
    </div>
  );
}
```

Le BOLT11 est une donnée destinée à être scannée par le payeur : il est normal qu'il soit transmis au navigateur. En revanche `preimage`, `disburse_token` et les clés ne le sont jamais.

---

## 5. Ce qu'il faut supprimer / garder

| Fichier | Action |
|---|---|
| `app/api/quote/route.ts` | **Supprimer** (remplacé par `quoteAction`) |
| `app/api/transfers/route.ts` | **Supprimer** (remplacé par `createTransferAction`) |
| `web/lib/api.ts` (helper `api()`), `lib/supabase.ts` client navigateur | **Supprimer** (plus de client Supabase côté navigateur) |
| `app/api/worker/route.ts` | Garder tel quel (§3.8 de `NEXTJS-SANS-CLI.md`) |
| `app/api/paydunya/callback/route.ts` | Garder tel quel (§3.9) |
| `lib/server/bitnob.ts`, `paydunya.ts`, `pricing.ts`, `transfers.ts` | Garder ; ajouter `import "server-only"` |
| Vue `transfers_public`, publication Realtime | Devenues **inutiles** (facultatif : les retirer) |

Dans `worker/route.ts` et `callback/route.ts`, l'import `@/lib/server/supabase` fournit toujours `admin` et `json` : aucune modification.

## 6. Points de vigilance

- **Server Actions = endpoints publics** : toute action doit appeler `requireUser()` (fait ci-dessus). Ne jamais déduire l'identité d'un paramètre envoyé par le client (`userId`, etc.).
- **Messages d'erreur** : seules les `UserError` et les messages de limites de `computeQuote` sont renvoyés ; les erreurs Bitnob/Supabase sont journalisées côté serveur uniquement.
- **Anti-abus** : ajoutez une limite de fréquence (par utilisateur) sur `quoteAction` et `createTransferAction` : table de compteurs ou service de rate-limiting.
- **Middleware** : le `matcher` exclut `/api/worker` et `/api/paydunya` pour que pg_cron et PayDunya ne soient jamais redirigés vers `/login`.
- **Cookies de session et confirmation e-mail** : si la confirmation d'e-mail est activée dans Supabase (*Authentication → Providers → Email*), `signUp` ne connecte pas immédiatement ; prévoyez un message « vérifiez votre e-mail ».
- **Rafraîchissement** : `router.refresh()` toutes les 4-5 s sollicite votre base à chaque passage ; c'est négligeable à petite échelle. À forte charge, repassez à Realtime ou allongez l'intervalle.
- **Attention à `dynamic = "force-dynamic"`** sur la page de suivi : sans lui, Next pourrait mettre la page en cache.
