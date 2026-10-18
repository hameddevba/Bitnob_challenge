-- migrations/004_pots_dashboard_refunds.sql
-- 1. Jeton de gestion secret par lien (historique, création de cagnottes)
ALTER TABLE recipients ADD COLUMN owner_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex');

-- 2. Cagnottes : un objectif, plusieurs contributeurs, chaque contribution part directement
--    sur le mobile money du bénéficiaire (l'application ne garde jamais les fonds).
CREATE TABLE pots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  recipient_id  UUID NOT NULL REFERENCES recipients(id),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  goal_fcfa     BIGINT NOT NULL CHECK (goal_fcfa > 0),
  closed        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pots_recipient ON pots(recipient_id);
ALTER TABLE pots ENABLE ROW LEVEL SECURITY;

ALTER TABLE transfers ADD COLUMN pot_id UUID REFERENCES pots(id);
ALTER TABLE transfers ADD COLUMN show_sender BOOLEAN NOT NULL DEFAULT true; -- nom visible sur la cagnotte
CREATE INDEX idx_transfers_pot ON transfers(pot_id);

ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_origin_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_origin_check
  CHECK (origin IN ('app','link','lightning_address','pot'));

-- 3. Remboursement automatique en Lightning
ALTER TYPE transfer_status ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TABLE transfers ADD COLUMN refund_reference TEXT UNIQUE;
ALTER TABLE transfers ADD COLUMN refunded_sats BIGINT;
