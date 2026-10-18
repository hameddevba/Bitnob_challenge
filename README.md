# Yónne

**Bitcoin ailleurs. FCFA chez vous.** Recevez de l'argent depuis n'importe quel pays et retirez-le sur votre Mobile Money (Orange Money, Wave, Free, Expresso), en quelques secondes.

Projet du hackathon **Code & Chain Dakar 2026**, construit sur l'API **Bitnob** (Lightning + Payouts mobile money).

**Démo en ligne : https://chemist-hardcover-unsecured.ngrok-free.dev** (sandbox Bitnob : le paiement Lightning se simule avec le bouton « Simuler le paiement » ; ngrok affiche d'abord une page d'avertissement, cliquer sur « Visit Site »).

---

## Le problème

Envoyer de l'argent vers le Sénégal coûte cher et prend du temps : frais élevés, intermédiaires, délais. Pourtant le bénéficiaire n'a souvent besoin que d'une chose : de l'argent sur son **Orange Money** ou son **Wave**.

## La solution

Yónne utilise **Bitcoin Lightning comme rail de transport** et **Bitnob comme rail de livraison** :

1. L'expéditeur saisit le montant **en FCFA** que le bénéficiaire doit recevoir.
2. Bitnob cote l'équivalent en sats ; l'expéditeur paie une facture Lightning depuis n'importe quel portefeuille, partout dans le monde.
3. Dès que le paiement est confirmé, Bitnob verse les FCFA sur le mobile money du bénéficiaire.

Le bénéficiaire ne touche jamais au bitcoin : il reçoit simplement un SMS de son opérateur.

## Fonctionnalités

| | Fonctionnalité | Écran |
|---|---|---|
| ✉️ | **Envoi** : montant en FCFA garanti, choix de l'opérateur (Orange, Wave, Free, Expresso), numéro saisi deux fois, récapitulatif façon reçu, QR Lightning, suivi en direct | `/` → `/recipient` → `/pay/[id]` |
| 🔗 | **Lien de paiement permanent** : le bénéficiaire partage `…/p/awa` sur WhatsApp, ses proches choisissent le montant et paient | `/creer`, `/p/[identifiant]` |
| ⚡ | **Adresse Lightning** `awa@domaine` (LNURL-pay) : payable depuis un portefeuille compatible | `/.well-known/lnurlp/[identifiant]` |
| 🎯 | **Cagnottes familiales** : un objectif (scolarité, Tabaski, santé…), plusieurs contributeurs, progression en direct ; chaque contribution part immédiatement sur le mobile money, l'application ne garde jamais les fonds | `/c/[slug]` |
| 📊 | **Espace bénéficiaire** : total reçu, historique, création de cagnottes | `/p/[identifiant]/gerer` |
| 🧾 | **Reçu avec preuve cryptographique** : la preimage Lightning, vérifiable dans le navigateur (SHA-256(preimage) = payment_hash) | `/recu/[id]` |
| ↩️ | **Remboursement automatique** en Lightning si l'envoi mobile money échoue définitivement | (automatique) |
| 🔍 | **Sous le capot** : chronologie technique de chaque envoi (cotation, facture, webhook, payout) | `/pay/[id]/journal` |
| 💸 | **Économie affichée** : dès la saisie du montant, « Vous économisez X FCFA » face à un transfert classique (~8 % de frais en moyenne vers l'Afrique, Banque mondiale) contre 1,5 % | `/` |
| 💬 | **Partage WhatsApp** du lien de paiement, des cagnottes et du reçu | `/creer`, `/c/[slug]`, `/p/[identifiant]/gerer`, `/recu/[id]` |
| 📱 | **Application mobile installable** (PWA) : ajout à l'écran d'accueil, plein écran, onglets Envoyer / Recevoir / Activité, historique gardé sur le téléphone | partout |
| 🖥️ | **Grand écran** : présentation à gauche (promesse, flux Bitcoin → Lightning → FCFA, opérateurs, chiffres clés), application dans une carte à droite | partout (≥ 1024 px) |
| 🎨 | **Design** : thème anthracite sobre, police Geist, traits fins, logos des opérateurs, ₿ animé en arrière-plan (désactivé si l'appareil demande moins d'animations) | partout |

## Ce que nous utilisons de Bitnob

| Endpoint Bitnob | Usage dans Yónne |
|---|---|
| `POST /api/payouts/quotes` | Cotation : X FCFA (ou X sats) ↔ sats, taux et frais. **Le taux affiché est celui exécuté.** |
| `POST /api/payouts/:quoteId/initialize` | Bénéficiaire mobile money (`network`, numéro, expéditeur) |
| `POST /api/payouts/:quoteId/finalize` | Déclenche le versement des FCFA |
| `GET /api/payouts/:id` | Source de vérité du statut du payout |
| `POST /api/lightning/invoices` | Facture Lightning que paie l'expéditeur |
| `GET /api/lightning/invoices/:id` | **Preuve du paiement** (`paid` + preimage), jamais le seul webhook |
| `POST /api/lightning/pay` | Remboursement automatique |
| `GET /api/payouts/supported-countries/SN` | Réseaux et format des numéros sénégalais |
| `GET /api/whoami`, `GET /api/balances` | Environnement (sandbox / live) et soldes |
| Webhooks | `btc.lightning.received.success`, `payouts.initialized`, `payouts.processing`, `payouts.withdrawal.success`, `payouts.withdrawal.expired` |

## Architecture

```
 Navigateur (mobile)             Serveur Next.js (API routes)                Bitnob
┌──────────────────┐   HTTPS   ┌──────────────────────────────┐   HMAC   ┌──────────────┐
│ Envoyer / Lien / │ ────────► │ cotation · facture · payout  │ ───────► │ Lightning    │
│ Cagnotte / Reçu  │ ◄──────── │ machine à états · journal    │ ◄─────── │ Payouts XOF  │
└──────────────────┘  polling  └──────────────┬───────────────┘ webhooks └──────┬───────┘
                                              │ SQL (transactions, verrous)      │
                                       ┌──────▼───────┐                  Orange Money / Wave
                                       │  Supabase    │
                                       │  PostgreSQL  │
                                       └──────────────┘
```

- **Stack** : Next.js 16 (App Router, TypeScript), PostgreSQL (Supabase), `pg`, `zod`, `qrcode`, Vitest.
- **Machine à états** d'un envoi : `AWAITING_PAYMENT → PAYOUT_PENDING → PAYOUT_PROCESSING → PAYOUT_SUCCESS`, avec `EXPIRED`, `PAYOUT_FAILED`, `REFUND_PENDING`, `REFUNDED`, `UNDERPAID`.
- **Journal d'audit** : chaque étape est enregistrée dans `transfer_events`.

📖 **Guide du code avec recherche** (fonctionnalités, fonctions, endpoints, tables, décisions) : ouvrir `/code-guide/index.html` sur l'application lancée, ou régénérer avec `npm run docs:build`.

## Sécurité

L'argent réel impose des garanties strictes :

- **Un webhook ne suffit jamais** : signature HMAC-SHA512 vérifiée, doublons ignorés, et le paiement est toujours **revérifié chez Bitnob** avant tout versement. Un faux webhook ne déclenche rien.
- **Jamais de double versement** : verrou de ligne en base, référence idempotente chez Bitnob, et la demande de finalisation est tracée *avant* l'appel ; tant que Bitnob n'a pas déclaré un payout mort, aucun second payout n'est créé.
- **Jamais à perte** : si le cours bouge au-delà des frais, l'envoi est bloqué et l'expéditeur remboursé.
- **Remboursement sûr** : seulement vers l'adresse donnée avant le paiement, montant de la facture vérifié, serveurs internes interdits (anti-SSRF), bloqué tant qu'un payout peut encore aboutir.
- **Montants en sats entiers** (jamais de flottants), recalculés côté serveur ; plafond par envoi.
- **Limitation par IP** des routes qui créent cotations et factures ; en-têtes de sécurité (anti-iframe, no-referrer, HSTS).
- **Base fermée** : RLS Supabase activé sur toutes les tables, accès uniquement par le serveur.
- **Clés uniquement côté serveur**, `.env.local` jamais commité.

## Lancer le projet

### Prérequis
- Node.js 20+ (testé avec Node 25), npm
- Un projet **Supabase** (ou PostgreSQL)
- Un compte **Bitnob** avec une application API (sandbox pour développer)
- **ngrok** pour exposer l'application (webhooks, tests sur téléphone)

### 1. Installer
```bash
npm install
cp .env.example .env.local
```

### 2. Base de données
Exécuter dans l'ordre, dans l'éditeur SQL de Supabase (ou avec `psql`) :
`migrations/001_init.sql`, `002_sn_mobile_money.sql`, `003_payment_links.sql`, `004_pots_dashboard_refunds.sql`.

Dans `.env.local`, `DATABASE_URL` = l'URL **Session pooler** de Supabase (IPv4). Vérifier :
```bash
npm run check:db
```

### 3. Bitnob
1. Sur app.bitnob.com, créer une application et copier le **Client ID** et le **Client Secret** (le secret commence par `prd:`… : le copier **en entier**).
2. **Autoriser l'adresse IP publique** de la machine dans le dashboard (sinon : `403 IP address not whitelisted`).
3. Déclarer l'URL de webhook : `https://<votre-domaine>/api/webhooks/bitnob`, et renseigner `BITNOB_WEBHOOK_SECRET`.
4. Vérifier (aucun argent ne bouge) :
```bash
npm run check:bitnob
```

### 4. Démarrer
```bash
npm run build
npm start
```
Dans un second terminal, la réconciliation automatique (paiements non notifiés, payouts, remboursements) :
```bash
npm run reconcile:loop
```
Pour l'ouvrir depuis un téléphone :
```bash
ngrok http 3000
```
puis mettre l'URL `https://…` dans `APP_URL`.

### Tests
```bash
npm test
```
44 tests unitaires : signature HMAC, calcul des montants, validation, preuve Lightning, remboursements, masquage du journal.

## Sandbox et simulation

En sandbox, les factures (`lntb…`) appartiennent au réseau de test : aucun portefeuille grand public ne peut les payer. Avec `SANDBOX_SIMULATION=true`, un bouton **« Simuler le paiement (sandbox) »** apparaît : il simule uniquement le paiement entrant ; le payout part **réellement** chez Bitnob sandbox. Ce bouton est **impossible à activer en production** (l'environnement est revérifié auprès de Bitnob à chaque fois).

## Passage en argent réel : liste de contrôle

- [ ] Clés **live** dans `.env.local`, organisation Bitnob activée, IP autorisée
- [ ] `SANDBOX_SIMULATION=false`
- [ ] `DATABASE_CA_CERT` = certificat SSL Supabase (vérification TLS de la base)
- [ ] `npm run build && npm start` (jamais `npm run dev` exposé publiquement)
- [ ] `npm run reconcile:loop` lancé
- [ ] Webhook Bitnob configuré avec son secret
- [ ] Plafond `NEXT_PUBLIC_MAX_FCFA` bas pour les premiers envois

## Limites connues

- **Adresse Lightning** : Bitnob ne pose pas de `description_hash` dans ses factures ; les portefeuilles qui le vérifient strictement (Phoenix, Zeus, Breez) refusent. Le lien de paiement fonctionne avec tous les portefeuilles.
- **Espace bénéficiaire** : accès par lien de gestion secret (mémorisé sur le téléphone), sans récupération s'il est perdu. Étape suivante : connexion numéro + code, puis vérification par SMS.
- **Conformité** : pas encore de plafonds par personne et par jour ; le cadre BCEAO/UEMOA est le premier chantier de la mise en production.
- **Corridor** : Sénégal pour l'instant ; l'API Bitnob couvre déjà la Côte d'Ivoire, le Niger, le Ghana, le Kenya… sans changement d'architecture.

## Équipe

Équipe de 5 développeurs, Code & Chain Dakar 2026 :

- Mouhamed Naby Ndoye
- Alpha Diallo
- Moussa Dione
- Fabien De Mayessi
- Ba Mohamed
