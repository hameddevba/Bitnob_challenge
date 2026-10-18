-- ============================================================================
-- SQL Patch pour NEXTJS-SERVER-SIDE (Authentification Supabase + RLS)
-- À coller dans : Supabase Dashboard > SQL Editor > Run
-- ============================================================================

-- 1. Ajout de la colonne user_id liant au compte auth.users (si absente)
alter table quotes add column if not exists user_id uuid references auth.users(id);
alter table transfers add column if not exists user_id uuid references auth.users(id);

create index if not exists quotes_user_id_idx on quotes (user_id);
create index if not exists transfers_user_id_idx on transfers (user_id);

-- 2. Activation de Row Level Security (RLS)
alter table quotes enable row level security;
alter table transfers enable row level security;
alter table transfer_events enable row level security;

-- 3. Policies RLS : chaque utilisateur ne peut lire que ses propres données
drop policy if exists "own transfers" on transfers;
create policy "own transfers" on transfers
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "own quotes" on quotes;
create policy "own quotes" on quotes
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Note : Le code serveur (avec SUPABASE_SERVICE_ROLE_KEY) contourne automatiquement la RLS.
