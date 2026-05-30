# Rummikub — konfiguracja Supabase (krok po kroku)

Ten przewodnik przeprowadzi Cię przez utworzenie backendu w Supabase: projekt, logowanie Google,
schemat bazy, reguły bezpieczeństwa (RLS) i bucket na avatary. Na końcu wklejasz dwa klucze do `index.html`.

---

## 1. Utwórz projekt Supabase

1. Wejdź na https://supabase.com → **Sign in** (np. przez GitHub).
2. **New project** → wybierz organizację, nadaj nazwę (np. `rummikub`), ustaw hasło do bazy (zapisz je), wybierz region (najbliżej Ciebie, np. *Central EU (Frankfurt)*).
3. Poczekaj ~2 min, aż projekt się utworzy.
4. W lewym menu: **Project Settings → API**. Skopiuj:
   - **Project URL** (np. `https://abcd1234.supabase.co`)
   - **anon public** key (długi token `eyJ...`)

   Te dwie wartości wkleisz później w `index.html` w sekcji `CONFIG`.

---

## 2. Włącz logowanie przez Google (OAuth)

### 2a. Google Cloud Console
1. Wejdź na https://console.cloud.google.com → utwórz projekt (lub wybierz istniejący).
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - Wypełnij nazwę aplikacji, email wsparcia, email dewelopera. Zapisz.
   - W „Test users" dodaj swój adres Gmail (dopóki apka jest w trybie testowym).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** — dodaj adres, z którego otwierasz apkę, np.:
     - `http://localhost:5500` (jeśli odpalasz lokalnie przez Live Server)
     - oraz docelowy adres hostingu, gdy go będziesz mieć (np. `https://twoja-apka.netlify.app`)
   - **Authorized redirect URIs** — wklej adres callbacku Supabase:
     - `https://<TWÓJ-REF>.supabase.co/auth/v1/callback`
       (`<TWÓJ-REF>` to fragment z Project URL, np. `abcd1234`)
   - Utwórz → skopiuj **Client ID** i **Client secret**.

### 2b. Supabase
1. W Supabase: **Authentication → Providers → Google** → włącz (Enable).
2. Wklej **Client ID** i **Client Secret** z Google. Zapisz.
3. **Authentication → URL Configuration**:
   - **Site URL**: adres, z którego korzystasz z apki (np. `http://localhost:5500` lub adres hostingu).
   - **Redirect URLs**: dodaj ten sam adres (i każdy inny, z którego będziesz otwierać apkę).

> Uwaga: logowanie Google wymaga, by apka była otwierana przez `http(s)://` (np. Live Server / hosting),
> a nie z pliku `file://`. Do testów wystarczy darmowy Live Server w VS Code albo `npx serve`.

---

## 3. Schemat bazy danych (SQL)

W Supabase otwórz **SQL Editor → New query**, wklej CAŁOŚĆ poniżej i kliknij **Run**.

```sql
-- ===== PROFILE =====
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  nick text not null,
  code text unique not null,           -- publiczny identyfikator do dodawania znajomych (np. RK-1042)
  avatar_url text,
  status text not null default 'on',   -- on | inv | off
  wins int not null default 0,
  games int not null default 0,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "profiles_select_all" on profiles for select using (true);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);

-- automatyczne utworzenie profilu po rejestracji
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

-- ===== ZNAJOMI (zaproszenia z akceptacją) =====
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references profiles(id) on delete cascade,
  to_user   uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending',   -- pending | accepted
  created_at timestamptz default now(),
  unique (from_user, to_user)
);
alter table friend_requests enable row level security;
create policy "fr_select_mine" on friend_requests for select
  using (auth.uid() = from_user or auth.uid() = to_user);
create policy "fr_insert_mine" on friend_requests for insert
  with check (auth.uid() = from_user);
create policy "fr_update_recipient" on friend_requests for update
  using (auth.uid() = to_user or auth.uid() = from_user);
create policy "fr_delete_mine" on friend_requests for delete
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ===== STOŁY =====
create table if not exists game_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility text not null default 'public',  -- public | private
  time_mode text not null default 'none',     -- none | 30 | 60
  host uuid not null references profiles(id) on delete cascade,
  status text not null default 'waiting',      -- waiting | playing | closed
  created_at timestamptz default now()
);
alter table game_tables enable row level security;
create policy "gt_select_visible" on game_tables for select using (
  visibility = 'public'
  or host = auth.uid()
  or exists (select 1 from table_members m where m.table_id = id and m.user_id = auth.uid())
  or exists (select 1 from table_invites i where i.table_id = id and i.user_id = auth.uid())
);
create policy "gt_insert_host" on game_tables for insert with check (auth.uid() = host);
create policy "gt_update_host" on game_tables for update using (auth.uid() = host);
create policy "gt_delete_host" on game_tables for delete using (auth.uid() = host);

-- ===== CZŁONKOWIE STOŁU =====
create table if not exists table_members (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  ready boolean not null default false,
  joined_at timestamptz default now(),
  primary key (table_id, user_id)
);
alter table table_members enable row level security;
create policy "tm_select_all" on table_members for select using (true);
-- (polityka INSERT z blokadą banów jest zdefiniowana niżej, w sekcji „BANY NA STOLE")
create policy "tm_update_self_or_host" on table_members for update using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
create policy "tm_delete_self_or_host" on table_members for delete using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);

-- ===== ZAPROSZENIA NA STÓŁ =====
create table if not exists table_invites (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (table_id, user_id)
);
alter table table_invites enable row level security;
create policy "ti_select_mine" on table_invites for select using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
create policy "ti_insert_host" on table_invites for insert with check (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
create policy "ti_delete_host_or_self" on table_invites for delete using (
  auth.uid() = user_id
  or exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);

-- ===== BANY NA STOLE (wyrzucenie na stałe) =====
create table if not exists table_bans (
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (table_id, user_id)
);
alter table table_bans enable row level security;
create policy "tb_select_all" on table_bans for select using (true);
create policy "tb_insert_host" on table_bans for insert with check (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
create policy "tb_delete_host" on table_bans for delete using (
  exists (select 1 from game_tables t where t.id = table_id and t.host = auth.uid())
);
-- blokada dołączenia dla zbanowanych
create policy "tm_insert_not_banned" on table_members for insert with check (
  auth.uid() = user_id
  and not exists (select 1 from table_bans b where b.table_id = table_id and b.user_id = auth.uid())
);

-- ===== CZAT =====
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references game_tables(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  nick text not null,
  body text not null,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "msg_select_members" on messages for select using (
  exists (select 1 from table_members m where m.table_id = messages.table_id and m.user_id = auth.uid())
  or exists (select 1 from game_tables t where t.id = messages.table_id and t.host = auth.uid())
);
create policy "msg_insert_self" on messages for insert with check (auth.uid() = user_id);

-- ===== REALTIME (powiadomienia na żywo) =====
alter publication supabase_realtime add table game_tables;
alter publication supabase_realtime add table table_members;
alter publication supabase_realtime add table table_invites;
alter publication supabase_realtime add table friend_requests;
alter publication supabase_realtime add table messages;
```

---

## 4. Bucket na avatary (Storage)

1. **Storage → Create a new bucket** → nazwa `avatars`, zaznacz **Public bucket** → Create.
2. **Storage → Policies → New policy** dla bucketu `avatars` (lub wklej w SQL Editor):

```sql
-- każdy może czytać (bucket publiczny), zalogowany może wgrać/zmienić swój plik
create policy "avatars_read" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars_write_own" on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
create policy "avatars_update_own" on storage.objects for update
  using (bucket_id = 'avatars' and auth.role() = 'authenticated');
```

---

## 5. Wklej klucze do aplikacji

Otwórz `index.html`, na początku znajdziesz blok:

```js
const SUPABASE_URL  = "WKLEJ_PROJECT_URL";
const SUPABASE_ANON = "WKLEJ_ANON_PUBLIC_KEY";
```

Wstaw wartości z punktu **1.4** i zapisz. Otwórz apkę przez `http(s)://` (Live Server / hosting),
kliknij **Zaloguj przez Google** — i gotowe.

---

## 6. Co działa po konfiguracji
- Logowanie i wylogowanie przez Google, profil tworzony automatycznie.
- Zmiana nicku, statusu i **avatara** (upload do Storage).
- Znajomi: dodawanie po **kodzie** (RK-XXXX) → zaproszenie, które druga osoba **akceptuje**.
- Stoły publiczne i prywatne, zaproszenia, poczekalnia, start gdy wszyscy gotowi.
- **Czat na stole** na żywo (realtime) z licznikiem nieprzeczytanych.
- Instalacja na telefonie „na pulpit" (PWA) — patrz niżej.

## 7. PWA — instalacja na telefonie
Apka ma `manifest.webmanifest`, `sw.js` i ikony. Gdy otworzysz ją na telefonie przez `https://`:
- **Android/Chrome**: pojawi się przycisk „Zainstaluj aplikację" (lub menu ⋮ → „Dodaj do ekranu głównego").
- **iPhone/Safari**: przycisk podpowie „Udostępnij → Dodaj do ekranu początkowego".
PWA działa najlepiej po wystawieniu na hostingu z HTTPS (np. Netlify, Vercel, GitHub Pages).

## 8. Uwaga o uczciwości gry (na przyszłość)
Walidacja układów jest teraz po stronie przeglądarki. Aby nie dało się oszukiwać, w kolejnym
kroku logikę ruchów warto przenieść do **Supabase Edge Functions** lub funkcji w Postgres
(autorytatywny serwer). To naturalne rozszerzenie po uruchomieniu wersji realtime.
