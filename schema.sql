-- ============================================================================
-- MVP transfert FCFA via Bitcoin Lightning (Bitnob + PayDunya) - SANS LOGIN
-- À coller dans : Supabase Dashboard > SQL Editor > New query > Run
--
-- Le script est RELANÇABLE : il crée ce qui manque et met à jour le reste.
-- Il ne supprime AUCUNE donnée (seules les colonnes user_id, devenues inutiles,
-- sont retirées si elles existent).
--
-- PARTIE 1 : à exécuter maintenant
-- PARTIE 2 : cron (à exécuter APRÈS le déploiement de l'app, voir plus bas)
-- ============================================================================


-- ============================================================================
-- PARTIE 1 : SCHÉMA
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Type des statuts
-- ----------------------------------------------------------------------------
do $$
begin
  create type transfer_status as enum (
    'awaiting_payment',   -- facture Lightning créée, en attente du paiement
    'btc_received',       -- BTC reçu, déboursement à lancer
    'payout_created',     -- token PayDunya créé (get-invoice)
    'payout_pending',     -- déboursement soumis, en cours chez l'opérateur
    'completed',          -- FCFA envoyés
    'expired',            -- facture expirée sans paiement
    'payout_failed',      -- déboursement échoué
    'refund_required',    -- BTC reçu mais FCFA non envoyés : remboursement à faire
    'refunded'            -- remboursé
  );
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Paramètres modifiables sans redéployer
-- ----------------------------------------------------------------------------
create table if not exists app_settings (
  key   text primary key,
  value jsonb not null
);

-- Limites basses pour le test (modifiables ensuite avec un UPDATE)
insert into app_settings (key, value) values
  ('limits', '{"min_xof": 500, "max_xof": 10000}')
on conflict (key) do update set value = excluded.value;

insert into app_settings (key, value) values
  ('pricing', '{"fee_percent": 1.5, "fee_fixed_xof": 100, "fx_spread_percent": 1.0}'),
  ('quote_ttl_seconds', '600')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Taux de change (cache + audit)
-- ----------------------------------------------------------------------------
create table if not exists fx_rates (
  id           bigint generated always as identity primary key,
  xof_per_btc  numeric(20,2) not null,
  source       text not null,
  fetched_at   timestamptz not null default now()
);
create index if not exists fx_rates_fetched_at_idx on fx_rates (fetched_at desc);

-- ----------------------------------------------------------------------------
-- Devis (taux verrouillé)
-- ----------------------------------------------------------------------------
create table if not exists quotes (
  id           uuid primary key default gen_random_uuid(),
  amount_xof   integer not null check (amount_xof > 0),    -- reçu par le destinataire
  fee_xof      integer not null check (fee_xof >= 0),
  total_xof    integer not null check (total_xof > 0),     -- montant + frais
  xof_per_btc  numeric(20,2) not null,
  amount_sats  bigint not null check (amount_sats between 1 and 20000000),  -- limite Bitnob
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Transferts
-- ----------------------------------------------------------------------------
create table if not exists transfers (
  id                    uuid primary key default gen_random_uuid(),
  payout_ref            bigint generated always as identity,   -- envoyé à PayDunya comme disburse_id
  quote_id              uuid not null unique references quotes(id),

  status                transfer_status not null default 'awaiting_payment',

  -- Montants (figés à la création)
  amount_xof            integer not null,
  fee_xof               integer not null,
  total_xof             integer not null,
  amount_sats           bigint  not null,
  xof_per_btc           numeric(20,2) not null,

  -- Destinataire
  recipient_name        text not null,
  recipient_country     text not null check (recipient_country in ('SN','CI','ML','BF')),
  recipient_phone       text not null,           -- sans indicatif pays (format PayDunya)
  withdraw_mode         text not null,           -- ex. orange-money-senegal

  -- Bitnob Lightning
  bitnob_invoice_id     uuid,
  bitnob_reference      text not null unique,    -- clé d'idempotence ('tx-' || id)
  payment_hash          text,
  bolt11                text,
  invoice_expires_at    timestamptz not null,
  preimage              text,
  paid_at               timestamptz,

  -- PayDunya
  disburse_token        text,
  disburse_status       text,                    -- created | pending | success | failed
  paydunya_tx_id        text,
  provider_ref          text,
  payout_fees_xof       numeric(12,2),
  payout_attempts       integer not null default 0,
  next_payout_retry_at  timestamptz,
  completed_at          timestamptz,
  failure_reason        text,

  -- Remboursement
  refund_invoice        text,                    -- facture Lightning fournie pour le remboursement
  refund_reference      text unique,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Verrou (bail) anti-double traitement par le worker
alter table transfers add column if not exists locked_until timestamptz;

create index if not exists transfers_status_created_idx on transfers (status, created_at);
create unique index if not exists transfers_payment_hash_uidx
  on transfers (payment_hash) where payment_hash is not null;

-- ----------------------------------------------------------------------------
-- Journal d'audit
-- ----------------------------------------------------------------------------
create table if not exists transfer_events (
  id           bigint generated always as identity primary key,
  transfer_id  uuid not null references transfers(id) on delete cascade,
  from_status  transfer_status,
  to_status    transfer_status,
  note         text,
  payload      jsonb,            -- réponses API (sans secrets)
  created_at   timestamptz not null default now()
);
create index if not exists transfer_events_transfer_idx on transfer_events (transfer_id, created_at);

-- ----------------------------------------------------------------------------
-- Dédoublonnage des callbacks PayDunya
-- ----------------------------------------------------------------------------
create table if not exists webhook_events (
  id           bigint generated always as identity primary key,
  provider     text not null,
  dedupe_key   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  unique (provider, dedupe_key)
);

-- ----------------------------------------------------------------------------
-- Nettoyage de l'ancienne version avec utilisateurs (sans effet si absente)
-- ----------------------------------------------------------------------------
drop policy if exists "own transfers" on transfers;
drop policy if exists "own quotes"    on quotes;
drop policy if exists "own events"    on transfer_events;
drop view   if exists transfers_public;
alter table transfers drop column if exists user_id;
alter table quotes    drop column if exists user_id;

-- ----------------------------------------------------------------------------
-- updated_at automatique
-- ----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_transfers_updated on transfers;
create trigger trg_transfers_updated
  before update on transfers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Transition atomique + audit.
-- Retourne true uniquement si le transfert était dans un état source autorisé :
-- impossible de traiter deux fois la même étape.
-- ----------------------------------------------------------------------------
create or replace function transition_transfer(
  p_id       uuid,
  p_from     transfer_status[],
  p_to       transfer_status,
  p_patch    jsonb default '{}'::jsonb,
  p_note     text  default null,
  p_payload  jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old transfer_status;
begin
  select status into v_old from transfers where id = p_id for update;
  if v_old is null or not (v_old = any(p_from)) then
    return false;
  end if;

  update transfers t set
    status               = p_to,
    preimage             = coalesce(p_patch->>'preimage', t.preimage),
    paid_at              = coalesce((p_patch->>'paid_at')::timestamptz, t.paid_at),
    disburse_token       = coalesce(p_patch->>'disburse_token', t.disburse_token),
    disburse_status      = coalesce(p_patch->>'disburse_status', t.disburse_status),
    paydunya_tx_id       = coalesce(p_patch->>'paydunya_tx_id', t.paydunya_tx_id),
    provider_ref         = coalesce(p_patch->>'provider_ref', t.provider_ref),
    payout_fees_xof      = coalesce((p_patch->>'payout_fees_xof')::numeric, t.payout_fees_xof),
    completed_at         = coalesce((p_patch->>'completed_at')::timestamptz, t.completed_at),
    failure_reason       = coalesce(p_patch->>'failure_reason', t.failure_reason),
    next_payout_retry_at = case when p_patch ? 'next_payout_retry_at'
                                then (p_patch->>'next_payout_retry_at')::timestamptz
                                else t.next_payout_retry_at end,
    payout_attempts      = t.payout_attempts + coalesce((p_patch->>'inc_attempts')::int, 0),
    locked_until         = null          -- libère le bail à chaque transition
  where t.id = p_id;

  insert into transfer_events (transfer_id, from_status, to_status, note, payload)
  values (p_id, v_old, p_to, p_note, p_payload);

  return true;
end $$;

-- ----------------------------------------------------------------------------
-- Réservation (bail de 60 s) des transferts à débourser.
-- Contrairement à un simple SELECT ... FOR UPDATE (verrou perdu dès la fin de
-- l'appel RPC), le bail est écrit en base : deux exécutions du worker qui se
-- chevauchent ne prennent jamais le même transfert.
-- ----------------------------------------------------------------------------
create or replace function claim_transfers_for_payout(p_limit int default 10)
returns setof transfers
language sql
security definer
set search_path = public
as $$
  update transfers t
     set locked_until = now() + interval '60 seconds'
   where t.id in (
     select id
       from transfers
      where status in ('btc_received', 'payout_created')
        and (locked_until is null or locked_until < now())
        and (status <> 'btc_received'
             or next_payout_retry_at is null
             or next_payout_retry_at <= now())
      order by paid_at
      limit p_limit
      for update skip locked
   )
  returning t.*;
$$;

-- Seul le code serveur (clé service_role) peut appeler ces fonctions
revoke all on function transition_transfer(uuid, transfer_status[], transfer_status, jsonb, text, jsonb)
  from public, anon, authenticated;
revoke all on function claim_transfers_for_payout(int)
  from public, anon, authenticated;
grant execute on function transition_transfer(uuid, transfer_status[], transfer_status, jsonb, text, jsonb)
  to service_role;
grant execute on function claim_transfers_for_payout(int)
  to service_role;

-- ----------------------------------------------------------------------------
-- Sécurité : RLS activée SANS aucune policy.
-- => l'API publique de Supabase (clé anon) ne peut rien lire ni écrire.
-- => seul le code serveur Next.js (service_role, qui contourne la RLS) y accède.
-- ----------------------------------------------------------------------------
alter table app_settings    enable row level security;
alter table fx_rates        enable row level security;
alter table quotes          enable row level security;
alter table transfers       enable row level security;
alter table transfer_events enable row level security;
alter table webhook_events  enable row level security;


-- ============================================================================
-- VÉRIFICATION (facultatif) : doit lister les 6 tables
-- ============================================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('app_settings','fx_rates','quotes','transfers','transfer_events','webhook_events');


-- ============================================================================
-- PARTIE 2 : CRON (à exécuter APRÈS le déploiement de l'app)
-- Remplacez VOTRE-DOMAINE et LA_MEME_VALEUR_QUE_WORKER_SECRET, puis
-- décommentez et exécutez ce bloc séparément.
-- ============================================================================

-- Extensions (si refusées ici : Dashboard > Database > Extensions, activer pg_cron et pg_net)
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;

-- Secret du worker dans le Vault (UNE seule fois)
-- select vault.create_secret('LA_MEME_VALEUR_QUE_WORKER_SECRET', 'worker_secret');

-- Appel du worker toutes les 30 secondes
-- select cron.schedule(
--   'process-transfers',
--   '30 seconds',
--   $$
--   select net.http_post(
--     url     := 'https://VOTRE-DOMAINE/api/worker',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret')
--     ),
--     body    := '{}'::jsonb,
--     timeout_milliseconds := 25000
--   );
--   $$
-- );

-- Nettoyage quotidien
-- select cron.schedule('cleanup-quotes', '0 3 * * *', $$
--   delete from quotes
--    where expires_at < now() - interval '7 days'
--      and id not in (select quote_id from transfers);
--   delete from fx_rates where fetched_at < now() - interval '30 days';
-- $$);

-- Suivi du cron
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 10;
-- select * from net._http_response order by created desc limit 5;
-- Arrêter : select cron.unschedule('process-transfers');


-- ============================================================================
-- REQUÊTES UTILES (suivi)
-- ============================================================================
-- Transferts bloqués (BTC reçu depuis plus de 5 min, FCFA non partis)
-- select id, status, paid_at, payout_attempts, failure_reason
--   from transfers
--  where status in ('btc_received','payout_created','payout_pending')
--    and paid_at < now() - interval '5 minutes';

-- Remboursements à traiter
-- select id, amount_sats, recipient_name, failure_reason
--   from transfers where status = 'refund_required';

-- Historique d'un transfert
-- select created_at, from_status, to_status, note from transfer_events
--  where transfer_id = '<UUID>' order by created_at;
