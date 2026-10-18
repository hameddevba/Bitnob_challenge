-- migrations/003_payment_links.sql
-- Lien de paiement permanent (domaine/p/awa) et adresse Lightning (awa@domaine) :
-- tout ce qui y est envoyé arrive sur le mobile money du bénéficiaire.
CREATE TABLE recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle            TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  recipient_name    TEXT NOT NULL,
  recipient_phone   TEXT NOT NULL,
  recipient_network TEXT NOT NULL DEFAULT 'orange'
                    CHECK (recipient_network IN ('orange','free','expresso','wave')),
  recipient_country TEXT NOT NULL DEFAULT 'SN',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transfers ADD COLUMN recipient_id UUID REFERENCES recipients(id);
ALTER TABLE transfers ADD COLUMN origin TEXT NOT NULL DEFAULT 'app'
  CHECK (origin IN ('app','link','lightning_address'));
CREATE INDEX idx_transfers_recipient ON transfers(recipient_id);

ALTER TABLE recipients ENABLE ROW LEVEL SECURITY;
