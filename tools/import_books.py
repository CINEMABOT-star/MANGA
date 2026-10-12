"""Importa le richieste TXT senza inserire le pagine di gestione nel catalogo."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from book_txt import BookOptions, firmware_catalogue, prepare_book

REQUEST_ID = re.compile(r'^[a-f0-9]{64}$')


def process_requests(repository: Path, progress=print):
    repository = repository.resolve()
    incoming = repository / 'biblioteca-input'
    status_root = repository / 'biblioteca-stato'
    status_root.mkdir(exist_ok=True)
    manifest_path = repository / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    # Validate the existing catalogue before touching any book.
    firmware_catalogue(manifest)
    os.environ['BIBLIOTECA_FONT_DIR'] = str(repository / 'biblioteca/fonts')
    imported = 0
    changed = []
    for request_path in sorted(incoming.glob('*/richiesta.json')):
        request_id = request_path.parent.name
        if not REQUEST_ID.fullmatch(request_id) or request_path.is_symlink():
            continue
        status_path = status_root / (request_id + '.json')
        if status_path.is_file():
            previous = json.loads(status_path.read_text(encoding='utf-8'))
            if previous.get('state') in ('ready', 'error'):
                continue
        status = {'request_id': request_id, 'updated_at': datetime.now(timezone.utc).isoformat()}
        try:
            if request_path.stat().st_size > 4096:
                raise ValueError('Impostazioni troppo grandi.')
            data = json.loads(request_path.read_text(encoding='utf-8'))
            if set(data) != {'version', 'title', 'author', 'font_size', 'pages_per_part', 'preserve_lines'} or data['version'] != 1:
                raise ValueError('Richiesta di importazione non valida.')
            if type(data['preserve_lines']) is not bool or type(data['font_size']) is not int or type(data['pages_per_part']) is not int:
                raise ValueError('Impostazioni del libro non valide.')
            options = BookOptions(data['title'], data['author'], data['font_size'], 'sans', data['pages_per_part'], data['preserve_lines'])
            if not isinstance(options.title, str) or not isinstance(options.author, str):
                raise ValueError('Titolo e autore non validi.')
            options.validate()
            source = request_path.parent / 'testo.txt'
            if source.is_symlink():
                raise ValueError('File TXT non valido.')
            with tempfile.TemporaryDirectory(prefix='biblioteca-') as temporary:
                prepared = prepare_book(source, options, Path(temporary), progress)
                existing = next((book for book in manifest['manga'] if book['id'] == prepared.book_id), None)
                if existing is not None and existing != prepared.entry:
                    raise ValueError('Esiste un libro diverso con questo identificativo.')
                if existing is None:
                    candidate = {**manifest, 'manga': [*manifest['manga'], prepared.entry]}
                    catalogue = firmware_catalogue(candidate)
                    for folder in ('manga', 'eink'):
                        target = repository / folder / prepared.book_id
                        if target.exists():
                            raise ValueError('Esistono file non catalogati con questo identificativo.')
                    for folder in ('manga', 'eink'):
                        shutil.copytree(prepared.directory / folder / prepared.book_id, repository / folder / prepared.book_id)
                    changed.extend(path.relative_to(prepared.directory).as_posix() for path in prepared.publication_files())
                    # Publish entries only after all parts have been rendered and verified.
                    manifest = candidate
                    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
                    (repository / 'eink/catalog.tsv').write_text(catalogue, encoding='utf-8', newline='\n')
                    changed.extend(('manifest.json', 'eink/catalog.tsv'))
                    imported += 1
                status.update(state='ready', title=options.title.strip(), book_id=prepared.book_id,
                              pages=len(prepared.page_paths), parts=len(prepared.entry['chapters']), pack_bytes=prepared.pack_bytes)
        except (ValueError, OSError, RuntimeError, TypeError, KeyError) as error:
            status.update(state='error', message=str(error)[:500])
            progress('Richiesta non importata: ' + request_id[:12])
        status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        changed.append(status_path.relative_to(repository).as_posix())
    # Exact paths only: never stage absent original manga in the sparse checkout.
    (repository / 'biblioteca-generated-files.txt').write_text('\n'.join(sorted(set(changed))) + ('\n' if changed else ''), encoding='utf-8', newline='\n')
    return imported


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    args = parser.parse_args()
    print('Libri aggiunti:', process_requests(args.repo))
