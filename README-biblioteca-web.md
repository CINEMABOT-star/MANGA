# Biblioteca da iPhone e PC

Apri https://cinemabot-star.github.io/MANGA/biblioteca/.

1. Scegli un TXT (su iPhone dall’app File), titolo e dimensione delle lettere.
2. Premi **Prepara anteprima**. Gli accenti vengono disegnati con Atkinson Hyperlegible; l’anteprima locale è indicativa.
3. Apri **Collega il tuo GitHub**. Il link precompila la creazione di un fine-grained personal access token con `Contents: Read and write`. Seleziona **Only select repositories → MANGA**, genera la chiave e incollala nel campo della pagina. Non servono permessi Actions o Workflows.
4. Premi **Pubblica sul mio sito**. Il browser invia TXT e impostazioni in un unico commit; GitHub Actions impagina, verifica le parti MGZ1 e aggiorna catalogo e sito.
5. Sul lettore scegli **Aggiorna catalogo**, poi il libro e una parte. Per il catalogo raw GitHub può servire qualche minuto.

La chiave resta esclusivamente in memoria finché la pagina è aperta: non viene salvata in localStorage, sessionStorage, file, URL o repository. Solo l’identificativo non segreto dell’ultima richiesta viene conservato sul dispositivo, per ritrovare una preparazione dopo aver chiuso Safari. Riapri la pagina, ricollega GitHub e premi **Controlla di nuovo**. Dopo l’invio il lavoro continua online anche chiudendo la pagina, con il PC spento.

Il repository è pubblico: testo originale, impostazioni, immagini e parti sono pubblici. La pagina di gestione non è collegata nel reader, non entra in `manifest.json` né in `eink/catalog.tsv`, e non compare sull’ESP32. L’indirizzo resta visitabile se conosciuto; scrivere nel repository richiede una chiave autorizzata.

I file `biblioteca-input/<id>/` contengono le richieste. `biblioteca-stato/<id>.json` comunica l’esito. Nessuno dei due è una voce del catalogo. Le edizioni già importate non vengono duplicate; altre impostazioni creano una nuova edizione. La versione web usa un identificativo distinto da quella desktop, perché usa un altro carattere.

GitHub Pages ospita solo HTML/CSS/JS, font e il catalogo per il browser. Le immagini dei libri e dei manga restano nel repository e vengono caricate da raw GitHub, come già accade per l’ESP32. Questo evita di pubblicare su Pages gli oltre 2 GB di immagini originali. I file originali del reader, la sua schermata di accesso e i manga non vengono modificati.

L’interfaccia non richiede installazioni. Su iPhone puoi usare **Condividi → Aggiungi alla schermata Home**. Sono supportati TXT UTF-8, UTF-16 con BOM e Windows-1252; limite 20 MB. PDF/EPUB non sono importati.
