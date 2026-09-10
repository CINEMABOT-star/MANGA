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
