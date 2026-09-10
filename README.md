# Pure Perverted Love Reader

Sito statico per leggere webtoon online tramite GitHub Pages.

## Accesso e segnalibri sincronizzati

L'accesso e i segnalibri usano Supabase, così lo stesso account funziona su più telefoni.
La chiave `anon` di Supabase è pubblica e può stare nel sito; non inserire mai la `service_role`.

1. Crea un progetto su [Supabase](https://supabase.com/).
2. Copia `supabase-config.example.js` in `supabase-config.js` e inserisci URL e chiave `anon`.
3. In Supabase vai su **SQL Editor** ed esegui:

```sql
create table public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  manga_id text not null,
  chapter_id text not null,
  page_index integer not null check (page_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, manga_id)
);

alter table public.bookmarks enable row level security;

create policy "Users can read their bookmark"
  on public.bookmarks for select using (auth.uid() = user_id);
create policy "Users can create their bookmark"
  on public.bookmarks for insert with check (auth.uid() = user_id);
create policy "Users can update their bookmark"
  on public.bookmarks for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

4. Pubblica anche `supabase-config.js` insieme al sito. Gli utenti possono registrarsi
   con email e password dal pulsante **Crea account**.

## Aggiungere immagini

1. Metti le immagini del capitolo in `chapters/capitolo-1`.
2. Nominale in ordine, per esempio:

```text
001.jpg
002.jpg
003.jpg
```

3. Esegui:

```powershell
cd C:\Users\iamdr\Desktop\MANGA
powershell -ExecutionPolicy Bypass -File .\tools\generate-manifest.ps1
```

4. Pubblica le modifiche:

```powershell
git add .
git commit -m "Add webtoon pages"
git push
```

Il link GitHub Pages resta sempre lo stesso.
