-- migrations/001_init.sql — d'après ARCHITECTURE_FCFA_BTC.md §4,
-- adapté : Bitnob Payouts (au lieu de PayDunya) et Lightning comme rail par défaut.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE transfer_status AS ENUM (
  'CREATED','AWAITING_PAYMENT','PAYMENT_DETECTED','UNDERPAID',
  'PAYOUT_PENDING','PAYOUT_PROCESSING','PAYOUT_SUCCESS','PAYOUT_FAILED',
  'EXPIRED','CANCELLED','REFUND_PENDING'
);

CREATE TYPE payment_rail AS ENUM ('lightning','onchain');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id),
  access_token        TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'), -- accès à la page de suivi

  -- montants
  amount_fcfa         BIGINT NOT NULL CHECK (amount_fcfa > 0),          -- montant garanti au bénéficiaire
  fee_fcfa            BIGINT NOT NULL DEFAULT 0 CHECK (fee_fcfa >= 0),  -- frais de service
  amount_btc_sats     BIGINT NOT NULL CHECK (amount_btc_sats > 0),      -- total à payer par l'expéditeur
  payout_cost_sats    BIGINT NOT NULL CHECK (payout_cost_sats > 0),     -- coût du payout Bitnob (montant + frais)
  rate_btc_xof        NUMERIC(24,8) NOT NULL,                           -- XOF par 1 BTC (cotation Bitnob)
  rate_expires_at     TIMESTAMPTZ NOT NULL,

  -- destinataire
  recipient_name      TEXT NOT NULL,
  recipient_phone     TEXT NOT NULL,
  recipient_country   TEXT NOT NULL DEFAULT 'SN',
  recipient_bank_code TEXT NOT NULL,                                    -- code opérateur (GET /api/payouts/banks/SN)
  refund_address      TEXT,                                             -- adresse Lightning de remboursement

  -- paiement entrant
  rail                payment_rail NOT NULL DEFAULT 'lightning',
  ln_invoice_id       TEXT UNIQUE,
  ln_payment_request  TEXT,
  ln_payment_hash     TEXT UNIQUE,
  ln_preimage         TEXT,                                             -- preuve de paiement
  btc_address         TEXT UNIQUE,                                      -- rail on-chain (optionnel)
  btc_received_sats   BIGINT NOT NULL DEFAULT 0,
  btc_txid            TEXT,
  confirmations       INT NOT NULL DEFAULT 0,

  -- payout Bitnob
  bitnob_quote_id     TEXT UNIQUE,
  bitnob_payout_id    TEXT UNIQUE,
  payout_reference    TEXT NOT NULL UNIQUE DEFAULT ('po-' || gen_random_uuid()), -- idempotence côté Bitnob
  payout_status       TEXT,

  status              transfer_status NOT NULL DEFAULT 'CREATED',
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (amount_btc_sats >= payout_cost_sats)                           -- jamais de transfert à perte
);

CREATE INDEX idx_transfers_status ON transfers(status);

-- Journal immuable de tous les événements (webhooks, appels API, transitions)
CREATE TABLE transfer_events (
  id           BIGSERIAL PRIMARY KEY,
  transfer_id  UUID REFERENCES transfers(id),
  source       TEXT NOT NULL,         -- 'bitnob' | 'system' | 'user'
  event_type   TEXT NOT NULL,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfer_events_transfer ON transfer_events(transfer_id, created_at);

-- Déduplication des webhooks reçus (event_id Bitnob)
CREATE TABLE webhook_receipts (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_transfers_updated
BEFORE UPDATE ON transfers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Supabase expose le schéma public via l'API REST : RLS activé sans politique
-- = aucun accès avec les clés anon/authenticated. Le serveur passe par DATABASE_URL.
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_receipts ENABLE ROW LEVEL SECURITY;
