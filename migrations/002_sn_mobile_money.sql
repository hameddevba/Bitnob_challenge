-- migrations/002_sn_mobile_money.sql
-- Le payout mobile money Sénégal attend un `network` (orange|free|expresso|wave), pas un bank_code,
-- et un expéditeur (sender.account_name, sender.country). Cf. GET /api/payouts/supported-countries/SN.
ALTER TABLE transfers RENAME COLUMN recipient_bank_code TO recipient_network;
ALTER TABLE transfers ALTER COLUMN recipient_network SET DEFAULT 'orange';
ALTER TABLE transfers ADD CONSTRAINT transfers_recipient_network_check
  CHECK (recipient_network IN ('orange','free','expresso','wave'));
ALTER TABLE transfers ADD COLUMN sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE transfers ADD COLUMN sender_country TEXT NOT NULL DEFAULT 'SN';
ALTER TABLE transfers ALTER COLUMN sender_name DROP DEFAULT;
