# MVP sans login (Next.js côté serveur)

Ce guide **remplace `NEXTJS-SERVER-SIDE.md`** pour un test simple : pas de compte, pas de session.
On garde : `lib/server/bitnob.ts`, `paydunya.ts`, `pricing.ts`, `transfers.ts`, `app/api/worker`, `app/api/paydunya/callback`, pg_cron (voir `NEXTJS-SANS-CLI.md`).

## 0. Principe

- L'utilisateur arrive sur `/`, saisit le montant, le destinataire, valide, puis est redirigé vers `/transfers/<id>` où s'affiche le QR.
- **Aucun client Supabase côté navigateur.** Tout passe par le serveur avec la clé `service_role`.
- **L'identifiant du transfert (UUID aléatoire) sert de « lien secret »** : qui a l'URL voit le suivi. C'est acceptable pour un test, pas pour la production.
- Les tables restent verrouillées pour l'API publique de Supabase (RLS activée, aucune policy) : même avec la clé `anon`, personne ne peut lire la base directement.

## 1. À supprimer par rapport à la version précédente

```
app/login/                     (dossier)
middleware.ts (ou proxy.ts)
lib/supabase/server.ts
app/api/quote/  app/api/transfers/
```

```bash
npm uninstall @supabase/ssr
```

Variables Supabase nécessaires : seulement `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`. La clé `anon` n'est plus utilisée.

## 2. Ajustement du SQL (SQL Editor)

Si vous avez **déjà** exécuté `0001_init.sql`, lancez ce patch. Sinon, faites-le aussi : il ne gêne pas.

```sql
-- Plus d'utilisateurs : on retire les policies, la vue publique et la colonne user_id
drop policy if exists "own transfers" on transfers;
drop policy if exists "own quotes"    on quotes;
drop policy if exists "own events"    on transfer_events;
drop view   if exists transfers_public;

alter table transfers drop column if exists user_id;
alter table quotes    drop column if exists user_id;

-- RLS reste ACTIVÉE sans policy => tables inaccessibles via l'API publique ;
-- seul le code serveur (service_role) y accède.
alter table transfers       enable row level security;
alter table quotes          enable row level security;
alter table transfer_events enable row level security;

-- Limites basses pour le test
update app_settings set value = '{"min_xof": 500, "max_xof": 10000}' where key = 'limits';
```

> La suppression de `user_id` supprime aussi son index. Le reste du schéma, `transition_transfer` et `claim_transfers_for_payout` ne dépend pas de cette colonne.

## 3. Garde-fou minimal (recommandé)

Sans login, n'importe qui peut déclencher des déboursements depuis **votre** solde PayDunya (une fois le BTC payé, mais l'API reste exposée à du spam de factures et de devis).
Pour un test : **gardez les clés de test** PayDunya/Bitnob (sandbox) et ajoutez un code d'accès partagé.

`.env.local` et variables de l'hébergeur :

```bash
MVP_ACCESS_CODE=un-code-que-vous-donnez-aux-testeurs
```

## 4. Service serveur : `lib/server/services.ts`

Même logique qu'avant, sans `userId`.

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { admin } from "./supabase";
import { computeQuote } from "./pricing";
import { createInvoice } from "./bitnob";
import { ORANGE_MODE, PHONE_RULES } from "./paydunya";

/** Erreur dont le message peut être affiché à l'utilisateur */
export class UserError extends Error {}

export async function createQuote(amountXof: number) {
  const q = await computeQuote(amountXof);                   // lève une Error lisible (limites, entier…)
  const expiresAt = new Date(Date.now() + q.quoteTtl * 1000).toISOString();

  const { data, error } = await admin.from("quotes").insert({
    amount_xof: q.amountXof, fee_xof: q.feeXof, total_xof: q.totalXof,
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

export async function createTransfer(input: {
  quoteId: string; name: string; country: string; phone: string;
}) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new UserError("Nom invalide");

  const country = input.country.toUpperCase();
  if (!ORANGE_MODE[country]) throw new UserError("Pays non supporté");

  const phone = input.phone.replace(/\D/g, "");
  if (!PHONE_RULES[country].test(phone)) throw new UserError("Numéro Orange Money invalide");

  const { data: quote } = await admin.from("quotes").select("*")
    .eq("id", input.quoteId).maybeSingle();
  if (!quote) throw new UserError("Devis introuvable");
  if (quote.used_at) throw new UserError("Devis déjà utilisé");
  if (new Date(quote.expires_at) < new Date()) throw new UserError("Devis expiré, recommencez");

  // Consommation atomique du devis (anti double-clic / rejeu)
  const { data: claimed } = await admin.from("quotes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", quote.id).is("used_at", null).select("id").maybeSingle();
  if (!claimed) throw new UserError("Devis déjà utilisé");

  const transferId = randomUUID();
  const reference = `tx-${transferId}`;
  const secondsLeft = Math.max(60, Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000));

  const inv = await createInvoice({
    amountSats: Number(quote.amount_sats),
    description: `Envoi ${quote.amount_xof} FCFA`,
    reference,
    expirySeconds: secondsLeft,
  });

  const { error } = await admin.from("transfers").insert({
    id: transferId, quote_id: quote.id,
    amount_xof: quote.amount_xof, fee_xof: quote.fee_xof, total_xof: quote.total_xof,
    amount_sats: quote.amount_sats, xof_per_btc: quote.xof_per_btc,
    recipient_name: name, recipient_country: country, recipient_phone: phone,
    withdraw_mode: ORANGE_MODE[country],
    bitnob_invoice_id: inv.id, bitnob_reference: reference,
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

## 5. Server Actions : `app/actions.ts`

```ts
"use server";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { createQuote, createTransfer, UserError } from "@/lib/server/services";

function codeOk(code: string) {
  const expected = process.env.MVP_ACCESS_CODE;
  if (!expected) return true;                         // code désactivé si la variable est absente
  const a = Buffer.from(code ?? ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type QuoteResult =
  | { ok: true; quote: Awaited<ReturnType<typeof createQuote>> }
  | { ok: false; error: string };

/** Étape 1 : montant → devis */
export async function quoteAction(amountXof: number, accessCode: string): Promise<QuoteResult> {
  if (!codeOk(accessCode)) return { ok: false, error: "Code d'accès invalide" };
  try {
    return { ok: true, quote: await createQuote(Number(amountXof)) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Étape 3 : validation → facture Lightning, puis redirection vers la page de suivi */
export async function createTransferAction(input: {
  quoteId: string; name: string; country: string; phone: string; accessCode: string;
}): Promise<{ ok: false; error: string }> {
  if (!codeOk(input.accessCode)) return { ok: false, error: "Code d'accès invalide" };

  let id: string;
  try {
    id = await createTransfer(input);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error("createTransfer", e);
    return { ok: false, error: "Impossible de créer le transfert" };
  }
  redirect(`/transfers/${id}`);            // hors try/catch : redirect() lève une exception de contrôle
}
```

## 6. Pages

### 6.1 `app/page.tsx`

```tsx
import SendWizard from "./SendWizard";
export default function Home() { return <SendWizard />; }
```

### 6.2 `app/SendWizard.tsx`

C'est le composant de `NEXTJS-SERVER-SIDE.md §4.2`, avec 4 changements :

```tsx
// 1) imports
import { quoteAction, createTransferAction, type QuoteResult } from "./actions";

// 2) état en plus
const [accessCode, setAccessCode] = useState("");

// 3) champ à l'étape 1, au-dessus du bouton « Continuer » (à retirer si MVP_ACCESS_CODE n'est pas défini)
<input value={accessCode} onChange={(e) => setAccessCode(e.target.value)}
       placeholder="Code d'accès" className="w-full rounded border p-3" />

// 4) appels
const r = await quoteAction(Number(amount), accessCode);
const r = await createTransferAction({ quoteId: quote.quote_id, name, country, phone, accessCode });
```

Le reste (étapes, résumé, validation) est identique.

### 6.3 `app/transfers/[id]/page.tsx`

Lecture avec le client serveur `admin` ; colonnes sûres uniquement (jamais `preimage` ni `disburse_token`).

```tsx
import { notFound } from "next/navigation";
import { admin } from "@/lib/server/supabase";
import AutoRefresh from "./AutoRefresh";
import PayQr from "./PayQr";

export const dynamic = "force-dynamic";

const FINAL = ["completed", "expired", "refunded"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { data: t } = await admin.from("transfers")
    .select("id,status,amount_xof,amount_sats,recipient_name,bolt11,invoice_expires_at")
    .eq("id", id).maybeSingle();
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 text-center">
      {!FINAL.includes(t.status) && <AutoRefresh everyMs={4000} />}

      {t.status === "awaiting_payment" && (
        <PayQr bolt11={t.bolt11} sats={Number(t.amount_sats)} expiresAt={t.invoice_expires_at} />
      )}

      {["btc_received", "payout_created", "payout_pending"].includes(t.status) && (
        <p className="text-lg">⚡ Bitcoin reçu, envoi de {t.amount_xof.toLocaleString("fr-FR")} FCFA à {t.recipient_name} en cours…</p>
      )}

      {t.status === "completed" && (
        <p className="text-xl">✅ Envoyé ! {t.recipient_name} a reçu {t.amount_xof.toLocaleString("fr-FR")} FCFA.</p>
      )}

      {t.status === "expired" && <p>⌛ Facture expirée. <a className="underline" href="/">Recommencer</a></p>}

      {["payout_failed", "refund_required", "refunded"].includes(t.status) && (
        <p>⚠️ L'envoi FCFA a échoué. Votre paiement Bitcoin sera remboursé : gardez cette référence : {t.id}</p>
      )}
    </div>
  );
}
```

`AutoRefresh.tsx` et `PayQr.tsx` : **inchangés** (`NEXTJS-SERVER-SIDE.md §4.4 et §4.5`).

## 7. Limites assumées de ce MVP

| Sujet | État dans ce MVP | Pour la suite |
|---|---|---|
| Qui est l'expéditeur | Inconnu (aucun compte) | Ajouter Supabase Auth, ou au moins un e-mail/téléphone de contact |
| Accès au suivi | Quiconque a l'URL `/transfers/<uuid>` | Authentification |
| Remboursement si le payout échoue | Pas de moyen de recontacter l'expéditeur : prévoyez un champ « e-mail / WhatsApp » (facultatif) dans le formulaire, sinon le support ne peut pas le joindre | Flux `request-refund` de `ARCHITECTURE.md §10.2` |
| Anti-abus | Seulement `MVP_ACCESS_CODE` + plafonds bas | Rate limiting par IP, KYC |
| Production | **Ne pas utiliser avec de vraies clés ni un vrai solde sans login et sans cadre juridique** | `ARCHITECTURE.md §11 et §13` |

Test conseillé : clés **sandbox** Bitnob et PayDunya (`test_private_…`), plafond à 10 000 FCFA, et un petit groupe de testeurs avec le code d'accès.
