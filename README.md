# Pure Perverted Love Reader

Sito statico per leggere webtoon online tramite GitHub Pages.

## Accesso e segnalibri sincronizzati

L'accesso usa solo un nome account e i segnalibri usano Supabase, così lo stesso nome
funziona su più telefoni. Non è una password: chiunque usi lo stesso nome vede e modifica
quei segnalibri.
La chiave `anon` di Supabase è pubblica e può stare nel sito; non inserire mai la `service_role`.

1. Crea un progetto su [Supabase](https://supabase.com/).
2. Copia `supabase-config.example.js` in `supabase-config.js` e inserisci URL e chiave `anon`.
3. In Supabase vai su **SQL Editor** ed esegui questo script. Ricrea la tabella precedente,
   quindi usalo solo se non ti servono i vecchi segnalibri:

```sql
drop table if exists public.bookmarks;

create table public.bookmarks (
  profile_name text not null check (char_length(profile_name) between 2 and 40),
  manga_id text not null,
  chapter_id text not null,
  page_index integer not null check (page_index >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_name, manga_id)
);

alter table public.bookmarks enable row level security;

create policy "Anyone can read bookmarks"
  on public.bookmarks for select to anon using (true);
create policy "Anyone can create bookmarks"
  on public.bookmarks for insert to anon with check (true);
create policy "Anyone can update bookmarks"
  on public.bookmarks for update to anon using (true) with check (true);
```

4. Pubblica anche `supabase-config.js` insieme al sito. Gli utenti entrano con il loro nome.

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
