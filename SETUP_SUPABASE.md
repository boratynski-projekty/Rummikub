# Rummikub — konfiguracja Supabase (krok po kroku)

Ten przewodnik przeprowadzi Cię przez utworzenie backendu w Supabase: projekt, logowanie Google,
schemat bazy, reguły bezpieczeństwa (RLS) i bucket na avatary.

---

## 1. Utwórz projekt Supabase
1. https://supabase.com → **Sign in** → **New project** (nazwa np. `rummikub`, zapisz hasło do bazy, region najbliżej Ciebie).
2. Po ~2 min: **Project Settings → API** → skopiuj **Project URL** i **anon public** key.
   Te wartości wpisujesz jako zmienne środowiskowe Next.js: `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (lokalnie w `.env.local`, na Vercelu w Environment Variables).

---

## 2. Logowanie Google (OAuth)

### 2a. Google Cloud Console
1. https://console.cloud.google.com → utwórz/wybierz projekt.
2. **APIs & Services → OAuth consent screen**: User type **External**, wypełnij nazwę + maile, dodaj swój Gmail w **Test users**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, typ **Web application**:
   - **Authorized JavaScript origins**: `http://localhost:3000` oraz `https://TWOJA-APKA.vercel.app`
   - **Authorized redirect URIs**: `https://<TWÓJ-REF>.supabase.co/auth/v1/callback`
   - Skopiuj **Client ID** i **Client secret**.

### 2b. Supabase
1. **Authentication → Providers → Google** → włącz → wklej Client ID + Secret → Save.
2. **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000` (do testów) lub adres Vercela.
   - **Redirect URLs**: dodaj `http://localhost:3000/**` i `https://TWOJA-APKA.vercel.app/**`
     (gwiazdki obejmują ścieżkę `/auth/callback`, której używa appka Next.js).

> Logowanie wymaga `http(s)://` — lokalnie `npm run dev` (http://localhost:3000), nie `file://`.

---

## 3. Schemat bazy (SQL)

W **SQL Editor → New query** wklej CAŁOŚĆ i kliknij **Run**.
Skrypt jest idempotentny (można uruchomić ponownie) — **najpierw tworzy wszystkie tabele, potem polityki**.

```sql
-- ========= 1) TABELE =========
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  nick text not null,
  code text unique not null,
  avatar_url text,
  status text not null default 'on',
  wins int not null default 0,
  games int not null default 0,
  created_at timestamptz default now()
);

create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references profiles(id) on delete cascade,
  to_user   uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz default now(),
  unique (from_user, to_user)
);

create table if not exists game_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null default 'public',
  time_mode text not null default 'none',
  host uuid not null references profiles(id) on delete cascade,
  status text not null default 'waiting',
  created_at timestamptz default now()
);

create table if not exists table_members (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  ready boolean not null default false,
  joined_at timestamptz default now(),
  primary key (table_id, user_id)
);

create table if not exists table_invites (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (table_id, user_id)
);

create table if not exists table_bans (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (table_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  nick text not null,
  body text not null,
  created_at timestamptz default now()
);

-- ========= 2) RLS =========
alter table profiles        enable row level security;
alter table friend_requests enable row level security;
alter table game_tables     enable row level security;
alter table table_members   enable row level security;
alter table table_invites   enable row level security;
alter table table_bans      enable row level security;
alter table messages        enable row level security;

-- ========= 3) POLITYKI (tworzone PO wszystkich tabelach) =========
-- profiles
drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles for select using (true);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update using (auth.uid() = id);
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert with check (auth.uid() = id);

-- friend_requests
drop policy if exists fr_select_mine on friend_requests;
create policy fr_select_mine on friend_requests for select using (auth.uid() = from_user or auth.uid() = to_user);
drop policy if exists fr_insert_mine on friend_requests;
create policy fr_insert_mine on friend_requests for insert with check (auth.uid() = from_user);
drop policy if exists fr_update_recipient on friend_requests;
create policy fr_update_recipient on friend_requests for update using (auth.uid() = to_user or auth.uid() = from_user);
drop policy if exists fr_delete_mine on friend_requests;
create policy fr_delete_mine on friend_requests for delete using (auth.uid() = from_user or auth.uid() = to_user);

-- game_tables
drop policy if exists gt_select_visible on game_tables;
create policy gt_select_visible on game_tables for select using (
  visibility = 'public'
  or host = auth.uid()
  or exists (select 1 from table_members m where m.table_id = id and m.user_id = auth.uid())
  or exists (select 1 from table_invites i where i.table_id = id and i.user_id = auth.uid())
);
drop policy if exists gt_insert_host on game_tables;
create policy gt_insert_host on game_tables for insert with check (auth.uid() = host);
drop policy if exists gt_update_host on game_tables;
create policy gt_update_host on game_tables for update using (auth.uid() = host);
drop policy if exists gt_delete_host on game_tables;
create policy gt_delete_host on game_tables for delete using (auth.uid() = host);

-- table_members
drop policy if exists tm_select_all on table_members;
create policy tm_select_all on table_members for select using (true);
drop policy if exists tm_insert_not_banned on table_members;
create policy tm_insert_not_banned on table_members for insert with check (
  auth.uid() = user_id
  and not exists (select 1 from table_bans b where b.table_id = table_id and b.user_id = auth.uid())
);
drop policy if exists tm_update_self_or_host on table_members;
create policy tm_update_self_or_host on table_members for update using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
drop policy if exists tm_delete_self_or_host on table_members;
create policy tm_delete_self_or_host on table_members for delete using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);

-- table_invites
drop policy if exists ti_select_mine on table_invites;
create policy ti_select_mine on table_invites for select using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
drop policy if exists ti_insert_host on table_invites;
create policy ti_insert_host on table_invites for insert with check (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
drop policy if exists ti_delete_host_or_self on table_invites;
create policy ti_delete_host_or_self on table_invites for delete using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);

-- table_bans
drop policy if exists tb_select_all on table_bans;
create policy tb_select_all on table_bans for select using (true);
drop policy if exists tb_insert_host on table_bans;
create policy tb_insert_host on table_bans for insert with check (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
drop policy if exists tb_delete_host on table_bans;
create policy tb_delete_host on table_bans for delete using (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);

-- messages
drop policy if exists msg_select_members on messages;
create policy msg_select_members on messages for select using (
  exists (select 1 from table_members m where m.table_id = messages.table_id and m.user_id = auth.uid())
  or exists (select 1 from game_tables t where t.id = messages.table_id and t.host = auth.uid())
);
drop policy if exists msg_insert_self on messages;
create policy msg_insert_self on messages for insert with check (auth.uid() = user_id);

-- ========= 4) AUTOMATYCZNY PROFIL PO REJESTRACJI =========
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, nick, code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    'RK-' || lpad((floor(random()*9000)+1000)::int::text, 4, '0')
  );
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ========= 5) REALTIME =========
alter publication supabase_realtime add table game_tables;
alter publication supabase_realtime add table table_members;
alter publication supabase_realtime add table table_invites;
alter publication supabase_realtime add table friend_requests;
alter publication supabase_realtime add table messages;
```

> Jeśli przy sekcji REALTIME pojawi się błąd „table is already member of publication", zignoruj go
> (oznacza, że tabela już jest w realtime) albo usuń te `alter publication` linie i uruchom ponownie.

---

## 4. Bucket na avatary (Storage)
1. **Storage → Create a new bucket** → nazwa `avatars`, zaznacz **Public bucket** → Create.
2. W **SQL Editor** wklej:

```sql
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');
```

---

## 5. Uruchomienie aplikacji (Next.js)
```bash
cp .env.example .env.local   # i uzupełnij klucze
npm install
npm run dev                  # http://localhost:3000
```
Deploy na Vercel: import repo (wykryje Next.js) + ustaw `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY`
w Environment Variables. Po deployu dodaj adres `…vercel.app` w Google (JS origins) i Supabase (Site URL + Redirect URLs `/**`).

## 6. Uczciwość gry (na przyszłość)
Walidacja układów jest teraz po stronie klienta. Aby uniemożliwić oszukiwanie, logikę ruchów warto
przenieść do **Supabase Edge Functions** / funkcji Postgres (autorytatywny serwer) — naturalny kolejny etap.
