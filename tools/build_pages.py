"""Build a small Pages site; large reading assets stay on the existing GitHub source."""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import quote

SOURCE = 'https://raw.githubusercontent.com/CINEMABOT-star/MANGA/main/'


def build(repository: Path, destination: Path):
    repository, destination = repository.resolve(), destination.resolve()
    if destination.exists():
        raise ValueError('Use a new output directory for the Pages build.')
    destination.mkdir(parents=True)
    for name in ('index.html', 'app.js', 'styles.css', '.nojekyll'):
        shutil.copyfile(repository / name, destination / name)
    shutil.copytree(repository / 'biblioteca', destination / 'biblioteca')
    manifest = json.loads((repository / 'manifest.json').read_text(encoding='utf-8-sig'))
    for book in manifest['manga']:
        if book.get('cover') and not book['cover'].startswith(('https://', 'http://')):
            book['cover'] = SOURCE + quote(book['cover'], safe='/')
        for chapter in book['chapters']:
            chapter['pages'] = [page if page.startswith(('https://', 'http://')) else SOURCE + quote(page, safe='/') for page in chapter['pages']]
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    # Includes completion/error receipts, never the original pending uploads.
    if (repository / 'biblioteca-stato').is_dir():
        shutil.copytree(repository / 'biblioteca-stato', destination / 'biblioteca-stato')
    return sum(path.stat().st_size for path in destination.rglob('*') if path.is_file())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path('.'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print('Pages bytes:', build(args.repo, args.output))
