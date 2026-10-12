"""Impagina TXT e prepara pagine PNG e capitoli MGZ1 per il lettore esistente."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata
import uuid

from PIL import Image, ImageDraw, ImageFont

from build_eink import CONTENT_HEIGHT, WIDTH, clean_title, write_pack

MAX_BOOK_BYTES = 20 * 1024 * 1024


@dataclass(frozen=True)
class BookOptions:
    title: str
    author: str = ''
    font_size: int = 18
    font_family: str = 'serif'
    pages_per_part: int = 50
    preserve_lines: bool = False

    def validate(self):
        if not self.title.strip() or len(self.title.strip().encode('utf-8')) > 150:
            raise ValueError('Inserisci un titolo, al massimo 150 byte UTF-8.')
        if any(c in self.title + self.author for c in '\r\n\t'):
            raise ValueError('Titolo e autore devono stare su una sola riga.')
        if len(self.author) > 120:
            raise ValueError('Il nome dell’autore è troppo lungo.')
        if self.font_size not in (16, 18, 20, 22):
            raise ValueError('Dimensione del testo non valida.')
        if self.font_family not in ('serif', 'sans'):
            raise ValueError('Carattere non valido.')
        if self.pages_per_part not in (50, 100, 200):
            raise ValueError('Scegli 50, 100 o 200 pagine per parte.')


@dataclass
class PreparedBook:
    directory: Path
    entry: dict
    options: BookOptions
    page_paths: list[Path]
    encoding: str
    pack_bytes: int

    @property
    def book_id(self):
        return self.entry['id']

    def publication_files(self) -> list[Path]:
        # Il descrittore book.json resta sul PC. Pubblica solo i contenuti del libro.
        return sorted(p for folder in ('manga', 'eink')
                      for p in (self.directory / folder).rglob('*') if p.is_file())


def read_txt(path: Path) -> tuple[str, str]:
    if path.stat().st_size > MAX_BOOK_BYTES:
        raise ValueError('Il TXT supera 20 MB. Dividilo in più volumi.')
    data = path.read_bytes()
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        text, encoding = data.decode('utf-16'), 'UTF-16'
    else:
        if b'\x00' in data:
            raise ValueError('Il file contiene dati binari: salvalo come TXT UTF-8.')
        try:
            text, encoding = data.decode('utf-8-sig'), 'UTF-8'
        except UnicodeDecodeError:
            try:
                text, encoding = data.decode('cp1252'), 'Windows-1252'
            except UnicodeDecodeError as error:
                raise ValueError('Codifica sconosciuta: salva il testo come UTF-8.') from error
    text = unicodedata.normalize('NFC', text.replace('\r\n', '\n').replace('\r', '\n'))
    text = ''.join(c for c in text if c in '\n\t\f' or unicodedata.category(c) != 'Cc')
    if not text.strip():
        raise ValueError('Il file non contiene testo.')
    return text, encoding


def load_font(family: str, size: int, bold=False):
    portable = os.environ.get('BIBLIOTECA_FONT_DIR')
    if portable:
        return ImageFont.truetype(str(Path(portable) / ('AtkinsonHyperlegible-Bold.ttf' if bold else 'AtkinsonHyperlegible-Regular.ttf')), size)
    windows = Path('C:/Windows/Fonts')
    name = ('georgiab.ttf' if bold else 'georgia.ttf') if family == 'serif' else ('arialbd.ttf' if bold else 'arial.ttf')
    candidates = [str(windows / name), 'DejaVuSerif-Bold.ttf' if bold and family == 'serif'
                  else 'DejaVuSerif.ttf' if family == 'serif'
                  else 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf']
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    raise ValueError('Carattere non trovato. Installa Georgia o Arial sul PC.')


def split_word(word: str, font, width: int) -> list[str]:
    pieces, current = [], ''
    for character in word:
        candidate = current + character
        if current and font.getlength(candidate) > width:
            pieces.append(current)
            current = character
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def wrap_line(text: str, font, width: int) -> list[str]:
    lines, current = [], ''
    for word in text.split():
        if font.getlength(word) > width:
            if current:
                lines.append(current)
                current = ''
            pieces = split_word(word, font, width)
            lines.extend(pieces[:-1])
            current = pieces[-1]
        else:
            candidate = current + (' ' if current else '') + word
            if current and font.getlength(candidate) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
    if current:
        lines.append(current)
    return lines


def layout_text(text: str, options: BookOptions) -> tuple[list[list[str]], int]:
    options.validate()
    font = load_font(options.font_family, options.font_size)
    ascent, descent = font.getmetrics()
    line_height = max(options.font_size + 5, ascent + descent + 2)
    max_lines = (426 - 48) // line_height
    lines = []
    if options.preserve_lines:
        for source_line in text.replace('\f', '\n\n').split('\n'):
            lines.extend(wrap_line(source_line, font, WIDTH - 28) or [''])
    else:
        paragraphs = re.split(r'\n[ \t]*\n+', text.replace('\f', '\n\n').strip())
        for paragraph in paragraphs:
            if lines:
                lines.append('')
            lines.extend(wrap_line(' '.join(paragraph.split()), font, WIDTH - 28))
    pages = []
    current = []
    for line in lines:
        if not current and not line:
            continue
        current.append(line)
        if len(current) == max_lines:
            pages.append(current)
            current = []
    if current:
        while current and not current[-1]:
            current.pop()
        if current:
            pages.append(current)
    if not pages:
        raise ValueError('Il testo non contiene righe leggibili.')
    if len(pages) > options.pages_per_part * 500:
        raise ValueError('Il libro supera le 500 parti del lettore. Dividilo in più volumi.')
    return pages, line_height


def ellipsize(text: str, font, width: int) -> str:
    if font.getlength(text) <= width:
        return text
    while text and font.getlength(text + '…') > width:
        text = text[:-1]
    return text + '…'


def render_page(lines: list[str], number: int, total: int, options: BookOptions, line_height: int) -> Image.Image:
    image = Image.new('L', (WIDTH, CONTENT_HEIGHT), 255)
    draw = ImageDraw.Draw(image)
    body = load_font(options.font_family, options.font_size)
    small = load_font('sans', 11)
    draw.text((14, 12), ellipsize(options.title.strip(), small, WIDTH - 28), font=small, fill=0, anchor='lt')
    draw.line((14, 33, WIDTH - 14, 33), fill=0)
    for index, line in enumerate(lines):
        draw.text((14, 48 + index * line_height), line, font=body, fill=0, anchor='lt')
    footer = f'{number} / {total}'
    draw.text((WIDTH // 2, 441), footer, font=small, fill=0, anchor='mt')
    # Testo netto su e-ink; gli accenti sono disegnati dal font, senza limiti CP437.
    return image.point(lambda value: 255 if value >= 170 else 0, mode='1')


def render_cover(options: BookOptions) -> Image.Image:
    image = Image.new('L', (WIDTH, CONTENT_HEIGHT), 255)
    draw = ImageDraw.Draw(image)
    title_font = load_font(options.font_family, 24, bold=True)
    small = load_font('sans', 12)
    draw.rectangle((8, 8, WIDTH - 9, CONTENT_HEIGHT - 9), outline=0, width=2)
    draw.text((24, 35), 'BIBLIOTECA', font=small, fill=0, anchor='lt')
    title_lines = wrap_line(options.title.strip(), title_font, WIDTH - 48)
    for index, line in enumerate(title_lines[:8]):
        draw.text((24, 93 + index * 31), line, font=title_font, fill=0, anchor='lt')
    if options.author.strip():
        author_font = load_font(options.font_family, 16)
        for index, line in enumerate(wrap_line(options.author.strip(), author_font, WIDTH - 48)[:3]):
            draw.text((24, 361 + index * 22), line, font=author_font, fill=0, anchor='lt')
    return image.point(lambda value: 255 if value >= 170 else 0, mode='1')


def prepare_book(path: Path, options: BookOptions, output_root: Path, progress=lambda message: None) -> PreparedBook:
    options.validate()
    progress('Leggo e impagino il testo…')
    text, encoding = read_txt(path)
    pages, line_height = layout_text(text, options)
    slug = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', options.title).encode('ascii', 'ignore').decode().lower()).strip('-')[:48] or 'senza-titolo'
    profile = b'BIBLIOTECA_TXT_WEB_V1\0' if os.environ.get('BIBLIOTECA_FONT_DIR') else b'BIBLIOTECA_TXT_V1\0'
    identity = profile + text.encode('utf-8') + json.dumps(asdict(options), ensure_ascii=False, sort_keys=True).encode('utf-8')
    book_id = f'libro-{slug}-{hashlib.sha256(identity).hexdigest()[:10]}'
    directory = output_root / (book_id + '-' + uuid.uuid4().hex[:8])
    image_root = directory / 'manga' / book_id
    pack_root = directory / 'eink' / book_id
    image_root.mkdir(parents=True)
    pack_root.mkdir(parents=True)
    (image_root / 'originale.txt').write_text(text, encoding='utf-8', newline='\n')
    render_cover(options).save(image_root / 'cover.png')
    chapters, page_paths, pack_bytes = [], [], 0
    chapter_rows = ['CHAPTERS1']
    for start in range(0, len(pages), options.pages_per_part):
        part = len(chapters) + 1
        chapter_id = f'chapter-{part}'
        destination = image_root / chapter_id
        destination.mkdir()
        part_paths = []
        stop = min(start + options.pages_per_part, len(pages))
        for index in range(start, stop):
            image_path = destination / f'{index - start + 1:05d}.png'
            render_page(pages[index], index + 1, len(pages), options, line_height).save(image_path)
            page_paths.append(image_path)
            part_paths.append(image_path)
            if (index + 1) % 20 == 0:
                progress(f'Preparo pagina {index + 1} di {len(pages)}…')
        count, size = write_pack(pack_root / (chapter_id + '.mgz'), part_paths)
        if count != len(part_paths):
            raise RuntimeError('La conversione ha prodotto schermate inattese.')
        if size > 1_700_000:
            raise ValueError('Una parte è troppo grande: scegli meno pagine per parte.')
        pack_bytes += size
        chapter_title = f'Parte {part} (p. {start + 1}-{stop})'
        chapters.append({'id': chapter_id, 'title': chapter_title,
                         'pages': [p.relative_to(directory).as_posix() for p in part_paths]})
        chapter_rows.append(f'{chapter_id}\t{chapter_title}\t1')
        progress(f'Parte {part} pronta: {count} pagine, {size // 1024} KB.')
    catalogue = '\n'.join(chapter_rows) + '\n'
    if len(catalogue.encode('utf-8')) > 32000:
        raise ValueError('Elenco delle parti troppo grande per il lettore.')
    (pack_root / 'chapters.tsv').write_text(catalogue, encoding='utf-8', newline='\n')
    entry = {'id': book_id, 'title': options.title.strip(), 'cover': f'manga/{book_id}/cover.png',
             'chapters': chapters, 'kind': 'text', 'author': options.author.strip()}
    description = {'entry': entry, 'options': asdict(options), 'encoding': encoding,
                   'pages': len(pages), 'pack_bytes': pack_bytes}
    (directory / 'book.json').write_text(json.dumps(description, ensure_ascii=False, indent=2), encoding='utf-8')
    progress(f'Pronto: {len(pages)} pagine in {len(chapters)} parti.')
    return PreparedBook(directory, entry, options, page_paths, encoding, pack_bytes)


def firmware_catalogue(manifest: dict) -> str:
    books = manifest.get('manga')
    if not isinstance(books, list) or len(books) > 50:
        raise ValueError('Il catalogo deve contenere al massimo 50 libri per questo firmware.')
    rows = ['MANGA1']
    for book in books:
        title = clean_title(book['title']).encode('utf-8')[:160].decode('utf-8', errors='ignore')
        rows.append(f"{book['id']}\t{title}\t{len(book['chapters'])}")
    body = '\n'.join(rows) + '\n'
    if len(body.encode('utf-8')) > 16000:
        raise ValueError('Il catalogo supera lo spazio del lettore.')
    return body
