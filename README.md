# Rummikub Online

Gra Rummikub online ze znajomymi: logowanie Google, znajomi (z akceptacją), stoły publiczne/prywatne,
poczekalnia ze startem gdy wszyscy gotowi, czat na żywo, statystyki, zmiana avatara, PWA (instalacja na telefonie).

## Stack
- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS**
- **Supabase** jako backend: Auth (Google OAuth), Postgres + RLS, Realtime, Storage (bucket `avatars`)
- PWA: `public/manifest.webmanifest`, `public/sw.js`, ikony

## Struktura
```
app/                 # App Router
  page.tsx           # redirect → /login lub /app wg sesji
  login/page.tsx     # logowanie Google
  auth/callback/     # wymiana kodu OAuth na sesję
  app/page.tsx       # wymaga sesji → renderuje grę
  layout.tsx, globals.css
components/GameApp.tsx  # cała aplikacja kliencka (lobby, znajomi, stoły, poczekalnia, czat, gra)
lib/supabase/        # klient przeglądarki, serwera i middleware (@supabase/ssr)
middleware.ts        # odświeżanie sesji
public/              # ikony, manifest, service worker
legacy/              # poprzednia wersja statyczna (referencyjnie, poza buildem)
```

## Zmienne środowiskowe
Skopiuj `.env.example` → `.env.local` i uzupełnij (Supabase → Project Settings → API):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```
Klucz `anon` jest publiczny i bezpieczny w kliencie (chroni go RLS). **Nigdy nie commituj `service_role`.**

## Uruchomienie lokalne
```bash
npm install
npm run dev
# http://localhost:3000
```

## Deploy na Vercel
1. `git push` na GitHub.
2. Vercel → **Add New → Project** → import repo. Framework wykryje się jako **Next.js** (bez ręcznej konfiguracji buildu).
3. W **Environment Variables** dodaj `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy → dostajesz `https://<projekt>.vercel.app`.

## Konfiguracja Supabase i Google OAuth
Pełna instrukcja: [`SETUP_SUPABASE.md`](./SETUP_SUPABASE.md) (schemat SQL, RLS, bucket, Google OAuth).

Ważne dla tej wersji Next.js — w **Supabase → Authentication → URL Configuration**:
- **Site URL**: `https://<projekt>.vercel.app` (lub `http://localhost:3000` do testów)
- **Redirect URLs**: dodaj `http://localhost:3000/**` oraz `https://<projekt>.vercel.app/**`
  (gwiazdki obejmują ścieżkę `/auth/callback`, której używa aplikacja)

W **Google Cloud → Credentials** redirect URI pozostaje bez zmian:
`https://sdquyipqyednphkokbxw.supabase.co/auth/v1/callback`, a w **Authorized JavaScript origins**
dodaj `http://localhost:3000` i adres Vercela.

## Status / dalsze kroki
Rozgrywka (klocki) jest na razie lokalna u każdego gracza, z walidacją po stronie klienta.
Pełna synchronizacja ruchów i autorytatywny serwer (anty-cheat) to naturalny następny etap —
najlepiej przez Supabase Realtime (broadcast stanu stołu) + Edge Functions do walidacji.
