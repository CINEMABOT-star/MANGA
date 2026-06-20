# Pure Perverted Love Reader

Sito statico per leggere webtoon online tramite GitHub Pages.

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

## Tradurre immagini sul PC

Installa le dipendenze:

```powershell
cd C:\Users\iamdr\Desktop\MANGA
py -m pip install -r .\tools\requirements-translate.txt
```

Testa poche pagine:

```powershell
py .\tools\translate_manga.py --input "C:\Users\iamdr\Documents\Mangas\Someone Stop Her! (Uncensored)" --output "C:\Users\iamdr\Documents\Mangas\TRADOTTI\Someone Stop Her! (Uncensored)" --limit 5 --cpu
```

Di default il tool usa `--mode bubble`, cioe traduce solo le bolle bianche e ignora effetti sonori, insegne e scritte fuori dai dialoghi.

Per testare solo un capitolo:

```powershell
py .\tools\translate_manga.py --input "C:\Users\iamdr\Documents\Mangas\Someone Stop Her! (Uncensored)" --output "C:\Users\iamdr\Documents\Mangas\TRADOTTI_TEST\Someone Stop Her! (Uncensored)" --chapter-filter "Chapter 1" --limit 2 --cpu --overwrite
```

Traduci tutto:

```powershell
py .\tools\translate_manga.py --input "C:\Users\iamdr\Documents\Mangas\Someone Stop Her! (Uncensored)" --output "C:\Users\iamdr\Documents\Mangas\TRADOTTI\Someone Stop Her! (Uncensored)" --cpu
```

Il tool crea una copia tradotta delle immagini. Dopo il controllo qualitativo, si puo importare quella cartella nel sito e pubblicarla.
