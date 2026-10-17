# Envoi de FCFA via Bitcoin : Bitnob + PayDunya + PostgreSQL

Documentation d'architecture et d'implémentation.

> **Avertissement** : les endpoints et champs Bitnob / PayDunya marqués ⚠️ sont à valider dans la documentation officielle (https://docs.bitnob.com et https://developers.paydunya.com) avant la mise en production. Les APIs évoluent.

---

## 1. Objectif et parcours utilisateur

1. L'utilisateur saisit le **montant en FCFA** à envoyer.
2. L'app calcule l'équivalent en **BTC** (taux figé pendant quelques minutes) et affiche les frais.
3. L'utilisateur saisit le **nom du destinataire** et son **numéro Orange Money**.
4. L'utilisateur **valide** le récapitulatif.
5. L'app génère une **adresse Bitcoin** (via Bitnob) et un **QR code** (URI BIP21 avec montant).
6. L'utilisateur scanne le QR avec son wallet et envoie les BTC.
7. Bitnob notifie l'app par **webhook** dès réception.
8. L'app déclenche le **décaissement PayDunya** vers l'Orange Money du destinataire.
9. L'utilisateur voit le statut final : **envoyé** ou **échec / remboursement à traiter**.

---

## 2. Architecture globale

```
┌──────────────┐     ┌─────────────────────────────────────────┐
│   Client     │     │              Serveur Next.js             │
│ (web / PWA)  │◄───►│  API routes + logique métier + worker    │
└──────────────┘     └───────┬───────────────┬─────────────────┘
                             │               │
                     ┌───────▼──────┐  ┌─────▼────────────┐
                     │  PostgreSQL  │  │  Bitnob API      │
                     │ (transferts, │  │ (adresses, rates,│
                     │  audit, taux)│  │  webhooks)       │
                     └──────────────┘  └─────┬────────────┘
                                             │ webhook
                                             ▼
                                   /api/webhooks/bitnob
                                             │
                                   ┌─────────▼──────────┐
                                   │ PayDunya disburse  │
                                   │ (Orange Money)     │
                                   └─────────┬──────────┘
                                             │ callback
                                             ▼
                                   /api/webhooks/paydunya
```

### Composants

| Composant | Rôle |
|---|---|
| **Next.js (App Router)** | UI + API routes (REST) |
| **PostgreSQL** | Source de vérité : transferts, événements, taux, journal d'audit |
| **Bitnob** | Génération d'adresse BTC, détection du paiement (webhook), taux |
| **PayDunya** | Décaissement FCFA vers Orange Money |
| **Worker (cron)** | Expiration des transferts, reprise des décaissements en échec, réconciliation |

---

## 3. Machine à états d'un transfert

```
CREATED ──validate──► AWAITING_PAYMENT ──btc détecté──► PAYMENT_DETECTED
   │                        │                                  │
   │                        └─ expiré ─► EXPIRED               ├─ montant OK ─► PAYOUT_PENDING ─► PAYOUT_SUCCESS (terminal)
   │                                                           │                      │
   └─ annulé ─► CANCELLED                                      ├─ sous-payé ─► UNDERPAID (revue manuelle)
                                                               └─ sur-payé  ─► PAYOUT_PENDING (+ flag OVERPAID)
                                                                              PAYOUT_PENDING ─► PAYOUT_FAILED (retry / revue)
```

Règle d'or : **toute transition est faite dans une transaction SQL** avec verrouillage de ligne (`SELECT ... FOR UPDATE`) pour éviter les doubles paiements.

---

## 4. Schéma PostgreSQL

```sql
-- migrations/001_init.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE transfer_status AS ENUM (
  'CREATED','AWAITING_PAYMENT','PAYMENT_DETECTED','UNDERPAID',
  'PAYOUT_PENDING','PAYOUT_SUCCESS','PAYOUT_FAILED','EXPIRED','CANCELLED'
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),

  -- montants
  amount_fcfa         BIGINT NOT NULL CHECK (amount_fcfa > 0),   -- montant reçu par le destinataire
  fee_fcfa            BIGINT NOT NULL DEFAULT 0,
  amount_btc_sats     BIGINT NOT NULL,                            -- à payer, en satoshis (jamais de float)
  rate_btc_xof        NUMERIC(24,8) NOT NULL,                     -- XOF par 1 BTC au moment du devis
  rate_expires_at     TIMESTAMPTZ NOT NULL,

  -- destinataire
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,                              -- format E.164 ou local, normalisé
  recipient_country   TEXT NOT NULL DEFAULT 'SN',

  -- Bitcoin / Bitnob
  btc_address         TEXT UNIQUE,
  bitnob_reference    TEXT,
  btc_received_sats   BIGINT NOT NULL DEFAULT 0,
  btc_txid            TEXT,
  confirmations       INT NOT NULL DEFAULT 0,

  -- PayDunya
  paydunya_token      TEXT,
  paydunya_disburse_id TEXT UNIQUE,                               -- idempotence côté PayDunya
  paydunya_status     TEXT,

  status              transfer_status NOT NULL DEFAULT 'CREATED',
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_transfers_address ON transfers(btc_address);

-- Journal immuable de tous les événements (webhooks, appels API, transitions)
CREATE TABLE transfer_events (
  id           BIGSERIAL PRIMARY KEY,
  transfer_id  UUID REFERENCES transfers(id),
  source       TEXT NOT NULL,         -- 'bitnob' | 'paydunya' | 'system' | 'user'
  event_type   TEXT NOT NULL,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Déduplication des webhooks reçus
CREATE TABLE webhook_receipts (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transfers_updated
BEFORE UPDATE ON transfers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Pourquoi des satoshis en `BIGINT`** : on évite toute erreur d'arrondi des flottants sur l'argent.

---

## 5. Structure du projet

```
fcfa-btc/
├── .env.local
├── package.json
├── migrations/
│   └── 001_init.sql
├── src/
│   ├── app/
│   │   ├── page.tsx                       # saisie du montant
│   │   ├── recipient/page.tsx             # nom + numéro Orange Money
│   │   ├── pay/[id]/page.tsx              # QR + statut en direct
│   │   └── api/
│   │       ├── quote/route.ts             # POST : devis FCFA → BTC
│   │       ├── transfers/route.ts         # POST : créer + valider
│   │       ├── transfers/[id]/route.ts    # GET : statut (polling)
│   │       ├── webhooks/bitnob/route.ts
│   │       ├── webhooks/paydunya/route.ts
│   │       └── cron/reconcile/route.ts
│   └── lib/
│       ├── db.ts
│       ├── bitnob.ts
│       ├── paydunya.ts
│       ├── rates.ts
│       ├── transfers.ts                   # logique métier + machine à états
│       └── validators.ts
└── README.md
```

---

## 6. Configuration

### 6.1 Variables d'environnement (`.env.local`)

```bash
# Base de données
DATABASE_URL=postgres://user:password@localhost:5432/fcfabtc

# Bitnob
BITNOB_BASE_URL=https://sandboxapi.bitnob.co/api/v1     # ⚠️ prod : https://api.bitnob.co/api/v1
BITNOB_SECRET_KEY=sk.xxxxxxxxxxxxxxxx
BITNOB_WEBHOOK_SECRET=xxxxxxxxxxxxxxxx                  # clé utilisée pour la signature

# PayDunya
PAYDUNYA_BASE_URL=https://app.paydunya.com
PAYDUNYA_MASTER_KEY=xxxxxxxx
PAYDUNYA_PRIVATE_KEY=test_private_xxxxxxxx
PAYDUNYA_TOKEN=xxxxxxxx

# App
APP_URL=https://ton-domaine.com
CRON_SECRET=un-long-secret-aleatoire
QUOTE_TTL_MINUTES=15
PAYMENT_TTL_MINUTES=60
SERVICE_FEE_PERCENT=1.5
MIN_FCFA=5000
MAX_FCFA=500000
```

> Ne **jamais** commiter les clés. Utilise les variables d'environnement de ton hébergeur en production.

### 6.2 Dépendances

```bash
npm i pg qrcode zod
npm i -D @types/pg @types/qrcode
```

### 6.3 Configuration des dashboards

**Bitnob**
1. Créer un compte *Bitnob for Business*, activer le **sandbox**.
2. Récupérer la clé secrète dans *Settings → API*.
3. Renseigner l'**URL de webhook** : `https://ton-domaine.com/api/webhooks/bitnob`.
4. En local : tunnel (`ngrok http 3000`) puis coller l'URL dans le dashboard.

**PayDunya**
1. Compte **Business activé** ; dans *Intégration API*, créer une application et récupérer Master Key, Private Key, Token.
2. Activer l'**API PER (décaissement)** pour WebPay/MobPay.
3. Approvisionner le **solde FCFA** du compte PayDunya (le décaissement est prélevé dessus).

---

## 7. Implémentation

### 7.1 `lib/db.ts`

```ts
import { Pool, PoolClient } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

### 7.2 `lib/rates.ts` : taux XOF/BTC

Bitnob n'est pas forcément la source la plus simple pour un taux BTC/XOF. Abstrais la source pour pouvoir la changer (⚠️ vérifie si Bitnob expose un endpoint de taux pour XOF ; sinon utilise une API de prix BTC/USD + taux USD/XOF).

```ts
// Retourne le nombre de XOF pour 1 BTC
export async function getBtcXofRate(): Promise<number> {
  // Option A : API de prix BTC/USD (ex. CoinGecko) + USD/XOF
  const r = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,xof"
  );
  const j = await r.json();
  if (!j?.bitcoin?.xof) throw new Error("Taux indisponible");
  return j.bitcoin.xof;
}

export function fcfaToSats(amountFcfa: number, rateXofPerBtc: number): number {
  const btc = amountFcfa / rateXofPerBtc;
  return Math.ceil(btc * 1e8); // arrondi supérieur : on ne perd jamais de valeur
}
```

### 7.3 `lib/bitnob.ts`

```ts
import crypto from "crypto";

const BASE = process.env.BITNOB_BASE_URL!;
const KEY = process.env.BITNOB_SECRET_KEY!;

async function bitnob(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Bitnob ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ⚠️ Vérifier le chemin et les champs exacts dans la doc Bitnob (Onchain → generate address)
export async function generateBtcAddress(customerEmail: string, label: string) {
  const json = await bitnob("/addresses/generate", { customerEmail, label });
  return json.data.address as string;
}

// Vérification de signature du webhook
export function verifyBitnobSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha512", process.env.BITNOB_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}
```

> ⚠️ L'algorithme exact (HMAC-SHA512 sur le corps brut) et la clé utilisée sont à confirmer dans la page *Webhooks* de Bitnob. L'en-tête est `x-bitnob-signature`.

### 7.4 `lib/paydunya.ts`

```ts
const BASE = process.env.PAYDUNYA_BASE_URL!;

const headers = {
  "Content-Type": "application/json",
  "PAYDUNYA-MASTER-KEY": process.env.PAYDUNYA_MASTER_KEY!,
  "PAYDUNYA-PRIVATE-KEY": process.env.PAYDUNYA_PRIVATE_KEY!,
  "PAYDUNYA-TOKEN": process.env.PAYDUNYA_TOKEN!,
};

export async function disburseOrangeMoney(opts: {
  phone: string;
  amountFcfa: number;
  disburseId: string; // identifiant unique = idempotence
}) {
  // Étape 1 : créer la facture de décaissement
  const r1 = await fetch(`${BASE}/api/v2/disburse/get-invoice`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      account_alias: opts.phone,
      amount: opts.amountFcfa,
      withdraw_mode: "orange-money-senegal",
      callback_url: `${process.env.APP_URL}/api/webhooks/paydunya`,
    }),
  });
  const inv = await r1.json();
  if (inv.response_code !== "00") throw new Error(`PayDunya get-invoice: ${JSON.stringify(inv)}`);

  // Étape 2 : soumettre
  const r2 = await fetch(`${BASE}/api/v2/disburse/submit-invoice`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      disburse_invoice: inv.disburse_token,
      disburse_id: opts.disburseId,
    }),
  });
  const sub = await r2.json();
  return { token: inv.disburse_token as string, result: sub };
}
```

> ⚠️ Champs de réponse (`response_code`, `disburse_token`, `disburse_id`) à confirmer dans la doc *Décaissement*. Mode `orange-money-senegal` : numéros sénégalais uniquement.

### 7.5 `lib/transfers.ts` : logique métier

```ts
import { withTx, pool } from "./db";
import { getBtcXofRate, fcfaToSats } from "./rates";
import { generateBtcAddress } from "./bitnob";
import { disburseOrangeMoney } from "./paydunya";

const FEE = Number(process.env.SERVICE_FEE_PERCENT ?? 1.5) / 100;

// 1) Devis (sans écriture en base)
export async function buildQuote(amountFcfa: number) {
  const rate = await getBtcXofRate();
  const fee = Math.ceil(amountFcfa * FEE);
  const totalFcfa = amountFcfa + fee;
  return {
    amountFcfa,
    feeFcfa: fee,
    totalFcfa,
    rate,
    sats: fcfaToSats(totalFcfa, rate),
    expiresAt: new Date(Date.now() + Number(process.env.QUOTE_TTL_MINUTES ?? 15) * 60_000),
  };
}

// 2) Création + validation : génère l'adresse BTC
export async function createTransfer(input: {
  userId: string; userEmail: string;
  amountFcfa: number; recipientName: string; recipientPhone: string;
}) {
  const q = await buildQuote(input.amountFcfa);

  const { rows } = await pool.query(
    `INSERT INTO transfers
      (user_id, amount_fcfa, fee_fcfa, amount_btc_sats, rate_btc_xof, rate_expires_at,
       recipient_name, recipient_phone, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CREATED') RETURNING id`,
    [input.userId, q.amountFcfa, q.feeFcfa, q.sats, q.rate, q.expiresAt,
     input.recipientName, input.recipientPhone]
  );
  const id = rows[0].id as string;

  const address = await generateBtcAddress(input.userEmail, `transfer-${id}`);
  const expiresAt = new Date(Date.now() + Number(process.env.PAYMENT_TTL_MINUTES ?? 60) * 60_000);

  await pool.query(
    `UPDATE transfers SET btc_address=$1, status='AWAITING_PAYMENT', expires_at=$2 WHERE id=$3`,
    [address, expiresAt, id]
  );
  return { id, address, sats: q.sats, expiresAt };
}

// 3) Réception d'un paiement BTC (appelé par le webhook Bitnob)
export async function onBtcReceived(p: {
  address: string; sats: number; txid: string; confirmations: number; externalId: string;
}) {
  return withTx(async (c) => {
    // Déduplication
    const dup = await c.query(
      `INSERT INTO webhook_receipts(provider, external_id) VALUES ('bitnob',$1)
       ON CONFLICT DO NOTHING RETURNING id`, [p.externalId]);
    if (dup.rowCount === 0) return { skipped: true };

    const { rows } = await c.query(
      `SELECT * FROM transfers WHERE btc_address=$1 FOR UPDATE`, [p.address]);
    const t = rows[0];
    if (!t) return { unknown: true };
    if (!["AWAITING_PAYMENT", "UNDERPAID", "EXPIRED"].includes(t.status)) return { ignored: true };

    const received = Number(t.btc_received_sats) + p.sats;

    // Tolérance de 0,5 % pour les micro-écarts de frais réseau / arrondi
    const minOk = Math.floor(Number(t.amount_btc_sats) * 0.995);
    const status = received >= minOk ? "PAYOUT_PENDING" : "UNDERPAID";

    await c.query(
      `UPDATE transfers SET btc_received_sats=$1, btc_txid=$2, confirmations=$3, status=$4 WHERE id=$5`,
      [received, p.txid, p.confirmations, status, t.id]);
    await c.query(
      `INSERT INTO transfer_events(transfer_id, source, event_type, payload)
       VALUES ($1,'bitnob','btc_received',$2)`, [t.id, JSON.stringify(p)]);

    return { transferId: t.id, status };
  });
}

// 4) Décaissement : verrouille puis appelle PayDunya
export async function runPayout(transferId: string) {
  // Verrou + passage à un état intermédiaire pour empêcher un double appel
  const t = await withTx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM transfers WHERE id=$1 AND status='PAYOUT_PENDING' FOR UPDATE SKIP LOCKED`,
      [transferId]);
    if (!rows[0]) return null;
    const disburseId = rows[0].paydunya_disburse_id ?? `tps-${rows[0].id}`;
    await c.query(`UPDATE transfers SET paydunya_disburse_id=$1 WHERE id=$2`, [disburseId, rows[0].id]);
    return { ...rows[0], paydunya_disburse_id: disburseId };
  });
  if (!t) return;

  try {
    const { token, result } = await disburseOrangeMoney({
      phone: t.recipient_phone,
      amountFcfa: Number(t.amount_fcfa),
      disburseId: t.paydunya_disburse_id,
    });
    await pool.query(
      `UPDATE transfers SET paydunya_token=$1, paydunya_status=$2, status='PAYOUT_SUCCESS' WHERE id=$3`,
      [token, JSON.stringify(result), t.id]);
    await pool.query(
      `INSERT INTO transfer_events(transfer_id, source, event_type, payload)
       VALUES ($1,'paydunya','disburse_submitted',$2)`, [t.id, JSON.stringify(result)]);
  } catch (e: any) {
    await pool.query(
      `UPDATE transfers SET status='PAYOUT_FAILED' WHERE id=$1`, [t.id]);
    await pool.query(
      `INSERT INTO transfer_events(transfer_id, source, event_type, payload)
       VALUES ($1,'paydunya','disburse_error',$2)`, [t.id, JSON.stringify({ error: e.message })]);
  }
}
```

### 7.6 API routes

**`api/quote/route.ts`**

```ts
import { z } from "zod";
import { buildQuote } from "@/lib/transfers";

const schema = z.object({
  amountFcfa: z.number().int()
    .min(Number(process.env.MIN_FCFA))
    .max(Number(process.env.MAX_FCFA)),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Montant invalide" }, { status: 400 });
  return Response.json(await buildQuote(parsed.data.amountFcfa));
}
```

**`api/transfers/route.ts`** : création et validation + QR code

```ts
import { z } from "zod";
import QRCode from "qrcode";
import { createTransfer } from "@/lib/transfers";

const schema = z.object({
  amountFcfa: z.number().int().min(Number(process.env.MIN_FCFA)).max(Number(process.env.MAX_FCFA)),
  recipientName: z.string().min(2).max(100),
  // numéro sénégalais Orange Money : 77 / 78 + 7 chiffres
  recipientPhone: z.string().regex(/^(77|78)\d{7}$/, "Numéro Orange Money invalide"),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // TODO : récupérer l'utilisateur authentifié (session)
  const user = { id: "…", email: "user@example.com" };

  const t = await createTransfer({ userId: user.id, userEmail: user.email, ...parsed.data });

  // URI BIP21 : bitcoin:<adresse>?amount=<BTC>
  const btcAmount = (t.sats / 1e8).toFixed(8);
  const uri = `bitcoin:${t.address}?amount=${btcAmount}`;
  const qr = await QRCode.toDataURL(uri, { width: 320, margin: 1 });

  return Response.json({ id: t.id, address: t.address, sats: t.sats, uri, qr, expiresAt: t.expiresAt });
}
```

**`api/transfers/[id]/route.ts`** : polling du statut

```ts
import { pool } from "@/lib/db";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const { rows } = await pool.query(
    `SELECT id, status, amount_fcfa, amount_btc_sats, btc_received_sats, confirmations, expires_at
     FROM transfers WHERE id=$1`, [params.id]);
  if (!rows[0]) return Response.json({ error: "Introuvable" }, { status: 404 });
  return Response.json(rows[0]);
}
```

**`api/webhooks/bitnob/route.ts`**

```ts
import { verifyBitnobSignature } from "@/lib/bitnob";
import { onBtcReceived, runPayout } from "@/lib/transfers";

export async function POST(req: Request) {
  const raw = await req.text(); // corps BRUT, indispensable pour la signature
  if (!verifyBitnobSignature(raw, req.headers.get("x-bitnob-signature"))) {
    return new Response("invalid signature", { status: 401 });
  }

  const evt = JSON.parse(raw);

  // ⚠️ Adapter au payload réel de Bitnob (event, data.address, data.satoshis, data.txId, data.id…)
  if (evt.event === "btc.onchain.received.success") {
    const d = evt.data;
    const r = await onBtcReceived({
      address: d.address,
      sats: Number(d.satoshis),
      txid: d.txId,
      confirmations: Number(d.confirmations ?? 0),
      externalId: d.id ?? d.txId,
    });
    if ("transferId" in r && r.status === "PAYOUT_PENDING") {
      // Ne pas bloquer la réponse : lancer en arrière-plan
      runPayout(r.transferId).catch(console.error);
    }
  }

  return new Response("ok", { status: 200 }); // toujours 200, sinon Bitnob renvoie l'événement
}
```

**`api/webhooks/paydunya/route.ts`**

```ts
import { pool } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // ⚠️ Vérifier la structure exacte et la méthode d'authentification du callback PayDunya.
  // Bonne pratique : ne pas faire confiance au corps, relancer une requête de statut côté PayDunya.
  await pool.query(
    `INSERT INTO transfer_events(source, event_type, payload) VALUES ('paydunya','callback',$1)`,
    [JSON.stringify(body)]);
  return new Response("ok");
}
```

**`api/cron/reconcile/route.ts`** : tâche périodique (toutes les 2 min)

```ts
import { pool } from "@/lib/db";
import { runPayout } from "@/lib/transfers";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response("forbidden", { status: 403 });

  // 1. Expirer les transferts non payés
  await pool.query(
    `UPDATE transfers SET status='EXPIRED'
     WHERE status='AWAITING_PAYMENT' AND expires_at < now()`);

  // 2. Reprendre les décaissements en attente (idempotent grâce à disburse_id)
  const { rows } = await pool.query(
    `SELECT id FROM transfers WHERE status='PAYOUT_PENDING' AND updated_at < now() - interval '1 minute'`);
  for (const r of rows) await runPayout(r.id);

  return Response.json({ retried: rows.length });
}
```

### 7.7 Interface (parcours en 3 écrans)

1. **Écran 1 : montant** : champ FCFA → appel `POST /api/quote` à chaque saisie (debounce) → affiche BTC, frais, total, durée de validité du taux.
2. **Écran 2 : destinataire** : nom + numéro Orange Money (validation côté client avec la même regex) → récapitulatif → bouton **Valider**.
3. **Écran 3 : paiement** : `POST /api/transfers` → affiche le **QR code**, l'adresse (bouton copier), le montant exact en BTC, un compte à rebours ; **polling** de `GET /api/transfers/:id` toutes les 5 s pour afficher : *En attente → Paiement détecté → FCFA envoyés ✅*.

---

## 8. Sécurité

| Risque | Mesure |
|---|---|
| Faux webhook | Vérifier la signature `x-bitnob-signature` sur le **corps brut** |
| Webhook rejoué | Table `webhook_receipts` + `UNIQUE(provider, external_id)` |
| Double décaissement | Verrou `FOR UPDATE` + `paydunya_disburse_id` unique + états explicites |
| Clés exposées | Variables d'environnement, jamais côté client |
| Fraude / abus | Authentification, limites min/max, limite par utilisateur/jour, rate limiting |
| Saisie incorrecte | Validation Zod, confirmation du nom + numéro avant validation |
| Altération des montants | Montants en `BIGINT`, recalcul côté serveur uniquement, jamais depuis le client |
| Fuite de données | HTTPS, logs sans données sensibles, accès base restreint |

---

## 9. Cas limites à gérer

- **Sous-paiement** : statut `UNDERPAID` → revue manuelle (compléter ou rembourser).
- **Sur-paiement** : décaisser le montant du devis et flagger l'excédent pour traitement.
- **Paiement après expiration** : accepté par `onBtcReceived` (statut `EXPIRED` autorisé) ; recalcul du taux à décider (ex. refuser et rembourser si le cours a trop bougé).
- **Délai de confirmation on-chain** : un paiement BTC peut prendre 10 à 60+ minutes. Décide d'un seuil (0 conf = risque de double dépense ; 1 conf = compromis courant) et affiche l'attente clairement à l'utilisateur.
- **Volatilité** : le taux est figé à la création, mais le BTC reçu peut valoir moins quand il est confirmé ; prévois une marge dans les frais.
- **Échec PayDunya** : statut `PAYOUT_FAILED`, relance automatique (idempotente) puis alerte admin ; ne jamais renvoyer sans le même `disburse_id`.
- **Solde PayDunya insuffisant** : monitorer le solde et alerter ; c'est la cause d'échec la plus probable.
- **Numéro invalide / compte Orange Money inexistant** : l'échec doit être remonté à l'utilisateur et le remboursement géré.

---

## 10. Point d'attention : Lightning vs on-chain

L'**on-chain** est lent (confirmations) et coûteux en frais réseau pour de petits montants. Pour un envoi de quelques dizaines de milliers de FCFA, le **Lightning Network** donne une UX bien meilleure : paiement quasi instantané, frais minimes. Bitnob supporte Lightning (événement `btc.lightning.received.success`). Tu peux construire l'app avec une abstraction `PaymentRail = 'onchain' | 'lightning'` et commencer par Lightning (invoice BOLT11 → QR) si tes utilisateurs ont un wallet compatible.

---

## 11. Contraintes réglementaires et métier

- **Pays du destinataire** : le mode `orange-money-senegal` ne couvre que le **Sénégal**. Pour la Mauritanie, vérifie avec PayDunya s'il existe un canal équivalent.
- **KYC / conformité** : transformer des cryptos en FCFA mobile money peut relever de la réglementation sur les services de transfert d'argent et la lutte anti-blanchiment (BCEAO, UEMOA). Vérifie ton statut juridique et les exigences KYC de Bitnob et PayDunya avant le lancement.
- **Liquidité** : Bitnob et PayDunya sont deux comptes séparés. Le BTC reçu chez Bitnob ne réapprovisionne pas automatiquement ton solde PayDunya. Prévois un processus de conversion/retrait régulier ou vérifie si Bitnob propose du règlement direct vers mobile money.

---

## 12. Plan de test

1. **Sandbox Bitnob** : générer une adresse, simuler/réaliser un dépôt test, vérifier le webhook via tunnel.
2. **Sandbox PayDunya** : tester `get-invoice` + `submit-invoice` avec les clés de test.
3. **Tests unitaires** : conversion FCFA → sats, machine à états, déduplication de webhooks.
4. **Tests d'intégration** : rejouer le même webhook 3 fois → un seul décaissement.
5. **Tests de panne** : couper PayDunya pendant le payout → vérifier `PAYOUT_FAILED` puis reprise par le cron.
6. **Mise en production progressive** : montants plafonnés bas, surveillance manuelle des premiers transferts.

---

## 13. Déploiement

- **Hébergement** : Vercel (Next.js) + PostgreSQL managé (Supabase, Neon, Railway).
- **Cron** : Vercel Cron ou service externe appelant `GET /api/cron/reconcile` toutes les 2 minutes avec `Authorization: Bearer $CRON_SECRET`.
- **Webhooks** : URLs HTTPS publiques déclarées dans les dashboards Bitnob et PayDunya.
- **Monitoring** : logs structurés, alerte sur `PAYOUT_FAILED`, `UNDERPAID` et solde PayDunya bas.

---

## 14. Checklist de mise en œuvre

- [ ] Créer la base PostgreSQL et exécuter `001_init.sql`
- [ ] Configurer `.env.local`
- [ ] Implémenter `lib/` (db, rates, bitnob, paydunya, transfers)
- [ ] Implémenter les routes API et les 3 écrans
- [ ] Configurer le webhook Bitnob (+ tunnel en local)
- [ ] Valider les champs ⚠️ avec la doc officielle
- [ ] Tester en sandbox (Bitnob + PayDunya)
- [ ] Mettre en place le cron de réconciliation
- [ ] Définir les seuils de confirmation et les frais
- [ ] Vérifier les aspects réglementaires/KYC
- [ ] Lancer en production avec plafonds bas
