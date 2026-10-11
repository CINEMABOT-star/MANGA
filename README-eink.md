# File da aggiungere al repository CINEMABOT-star/MANGA

Questo pacchetto aggiunge il supporto al lettore ESP32-C3. I file del sito esistente restano utilizzabili: il lettore usa una cartella dedicata `eink`.

Contenuto:

- `eink/catalog.tsv` e gli elenchi `eink/<manga>/chapters.tsv`: catalogo leggero.
- `eink/pure-perverted-love/chapter-1.mgz`: primo capitolo reale convertito e verificato, 215 schermate, 1.874.852 byte.
- `tools/build_eink.py`: convertitore delle immagini lunghe del `manifest.json` esistente.
- `.github/workflows/eink.yml`: conversione manuale con GitHub Actions.

## Pubblicazione

Aggiungere questi file alla radice del repository `CINEMABOT-star/MANGA`, ramo `main`. Il firmware usa direttamente i file pubblici su `raw.githubusercontent.com`, senza dipendere dalla ricostruzione di GitHub Pages. Non sono ancora online finché non viene effettuato il commit.

Dopo il commit, aprire **Actions → Prepare e-ink manga → Run workflow**. Per preparare tutti i capitoli lasciare i due campi vuoti. Per un manga inserire il suo ID; per un singolo capitolo inserire anche l'ID del capitolo, ad esempio `pure-perverted-love` e `chapter-1`. Attendere il completamento: l'azione pubblica i file convertiti tramite un commit nel repository.

L'azione legge le immagini presenti nel repository e riutilizza i capitoli già preparati. Per sostituire le immagini di un capitolo già convertito, rimuovere il relativo `.mgz` prima di rieseguire l'azione. Per aggiungere nuovi capitoli aggiornare il `manifest.json`, eseguire la conversione e scegliere «Aggiorna catalogo» sul lettore.

La preparazione completa richiede tempo, ma avviene sul PC o su GitHub e si fa una volta. La scheda scarica soltanto il capitolo scelto o le sue schermate.

## Conversione locale

```shell
python -m pip install 'Pillow>=12.0,<13'
python tools/build_eink.py --repo . --output eink --all --workers 3
```

Il formato MGZ1 contiene un'intestazione di 16 byte, una voce da 12 byte per schermata e le schermate zlib. Dimensione 280 × 480, 1 bit per pixel, bit 1 = nero. Ogni voce indica offset, lunghezza compressa e CRC32 del bitmap; il firmware verifica i dati prima di mostrarli.
