# Rummikub Online

Gra Rummikub do gry online ze znajomymi. Logowanie przez Google, znajomi, stoły publiczne/prywatne,
czat na żywo, statystyki, PWA (instalacja na telefonie). Backend: **Supabase**. Hosting: **Vercel**.

## Stack
- Front-end: jeden plik `index.html` (vanilla JS), `supabase-js` z CDN
- Backend: Supabase (Auth Google, Postgres + RLS, Realtime, Storage na avatary)
- PWA: `manifest.webmanifest`, `sw.js`, ikony

## Uruchomienie lokalne
Logowanie Google wymaga `http(s)://` (nie `file://`). Najprościej:

```bash
npx serve .
# albo w VS Code: rozszerzenie "Live Server"
```

Otwórz podany adres (np. http://localhost:3000).

## Konfiguracja Supabase
Pełna instrukcja: [`SETUP_SUPABASE.md`](./SETUP_SUPABASE.md) — schemat SQL, Google OAuth, bucket avatarów.
Klucze (`Project URL` i `anon key`) są wpisane w `index.html` w bloku `CONFIG`. Klucz `anon` jest
publiczny i bezpieczny w kodzie front-endu (dostęp chronią reguły RLS). **Nigdy nie commituj klucza `service_role`.**

## Deploy na Vercel
1. Wypchnij repo na GitHub.
2. Vercel → **Add New → Project** → zaimportuj repo `Rummikub`.
3. Framework Preset: **Other** (to statyczna strona, bez buildu). Root: `/`.
4. Deploy. Dostaniesz adres `https://<projekt>.vercel.app`.
5. Dodaj ten adres w trzech miejscach (patrz niżej w SETUP), żeby zadziałało logowanie Google na produkcji.

## Pliki
- `index.html` — cała aplikacja
- `SETUP_SUPABASE.md` — konfiguracja backendu
- `manifest.webmanifest`, `sw.js`, `icon*.png`, `icon.svg`, `apple-touch-icon.png` — PWA
- `vercel.json` — nagłówki dla service workera i manifestu
