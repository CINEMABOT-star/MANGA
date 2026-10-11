"""Convert the existing manga manifest into a small catalogue and chapter packs."""
from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import math
from pathlib import Path
import re
import struct
import time
import urllib.parse
import urllib.request
import zlib

from PIL import Image, ImageOps

WIDTH, HEIGHT, CONTENT_HEIGHT, OVERLAP = 280, 480, 460, 20
FRAME_BYTES = WIDTH * HEIGHT // 8
HEADER = struct.Struct('<4sHHII')
ENTRY = struct.Struct('<III')
SOURCE = 'https://cinemabot-star.github.io/MANGA/'
Image.MAX_IMAGE_PIXELS = 80_000_000


def safe_id(value: str) -> str:
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', value):
        raise ValueError(f'Invalid identifier: {value!r}')
    return value


def clean_title(value: str) -> str:
    return value.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ')[:160]


def fetch(url: str) -> bytes:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'MangaEinkBuilder/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(1 + attempt)
    raise RuntimeError('Download failed')


def frames(image: Image.Image):
    image = ImageOps.exif_transpose(image)
    if image.width < 1 or image.height < 1:
        raise ValueError('Empty image')
    if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
        rgba = image.convert('RGBA')
        background = Image.new('RGBA', rgba.size, 'white')
        background.alpha_composite(rgba)
        image = background.convert('RGB')
    scaled_height = max(1, round(image.height * WIDTH / image.width))
    grey = image.convert('L').resize((WIDTH, scaled_height), Image.Resampling.LANCZOS)
    top = 0
    while top < scaled_height:
        bottom = min(top + CONTENT_HEIGHT, scaled_height)
        screen = Image.new('L', (WIDTH, HEIGHT), 255)
        screen.paste(grey.crop((0, top, WIDTH, bottom)), (0, 0))
        bitmap = screen.convert('1', dither=Image.Dither.FLOYDSTEINBERG).tobytes()
        # Adafruit drawBitmap uses 1 for ink, whereas Pillow uses 1 for white.
        yield bytes(byte ^ 255 for byte in bitmap)
        if bottom == scaled_height:
            break
        top = bottom - OVERLAP


def write_pack(destination: Path, image_paths: list[Path]) -> tuple[int, int]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload_path = destination.with_suffix('.payload.tmp')
    output_path = destination.with_suffix('.tmp')
    entries = []
    try:
        with payload_path.open('wb') as payload:
            for image_path in image_paths:
                with Image.open(image_path) as image:
                    for bitmap in frames(image):
                        if len(bitmap) != FRAME_BYTES:
                            raise ValueError('Invalid frame size')
                        compressed = zlib.compress(bitmap, 9)
                        entries.append((payload.tell(), len(compressed), zlib.crc32(bitmap)))
                        payload.write(compressed)
        if not entries or len(entries) > 8192:
            raise ValueError('Unsupported chapter frame count')
        offset = HEADER.size + ENTRY.size * len(entries)
        total = offset + payload_path.stat().st_size
        with output_path.open('wb') as output, payload_path.open('rb') as payload:
            output.write(HEADER.pack(b'MGZ1', WIDTH, HEIGHT, len(entries), total))
            for position, length, crc in entries:
                output.write(ENTRY.pack(offset + position, length, crc))
            while block := payload.read(65536):
                output.write(block)
        validate_pack(output_path)
        output_path.replace(destination)
        return len(entries), total
    finally:
        payload_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)


def validate_pack(path: Path) -> int:
    data = path.read_bytes()
    if len(data) < HEADER.size:
        raise ValueError('Truncated pack')
    magic, width, height, count, total = HEADER.unpack_from(data)
    if magic != b'MGZ1' or (width, height) != (WIDTH, HEIGHT) or not 1 <= count <= 8192 or total != len(data):
        raise ValueError('Invalid pack header')
    expected_offset = HEADER.size + count * ENTRY.size
    for index in range(count):
        offset, length, crc = ENTRY.unpack_from(data, HEADER.size + index * ENTRY.size)
        if offset != expected_offset or not 1 <= length <= 20000 or offset + length > total:
            raise ValueError('Invalid frame entry')
        bitmap = zlib.decompress(data[offset:offset + length])
        if len(bitmap) != FRAME_BYTES or zlib.crc32(bitmap) != crc:
            raise ValueError('Invalid frame checksum')
        expected_offset += length
    if expected_offset != total:
        raise ValueError('Unexpected trailing data')
    return count


def write_catalogues(manifest: dict, output: Path, bootstrap: Path | None):
    root_lines = ['MANGA1']
    book_data = []
    for manga in manifest['manga']:
        manga_id = safe_id(manga['id'])
        root_lines.append(f"{manga_id}\t{clean_title(manga['title'])}\t{len(manga['chapters'])}")
        lines = ['CHAPTERS1']
        for chapter in manga['chapters']:
            chapter_id = safe_id(chapter['id'])
            ready = int((output / manga_id / (chapter_id + '.mgz')).is_file())
            lines.append(f"{chapter_id}\t{clean_title(chapter['title'])}\t{ready}")
        body = '\n'.join(lines) + '\n'
        book_dir = output / manga_id
        book_dir.mkdir(parents=True, exist_ok=True)
        (book_dir / 'chapters.tsv').write_text(body, encoding='utf-8', newline='\n')
        book_data.append((manga_id, body))
    root = '\n'.join(root_lines) + '\n'
    (output / 'catalog.tsv').write_text(root, encoding='utf-8', newline='\n')
    if bootstrap:
        content = '#pragma once\n#include <Arduino.h>\n'
        content += 'const char BOOTSTRAP_CATALOG[] PROGMEM = R"CAT(' + root + ')CAT";\n'
        for n, (_, body) in enumerate(book_data):
            content += f'const char BOOTSTRAP_CHAPTERS_{n}[] PROGMEM = R"CAT(' + body + ')CAT";\n'
        content += 'struct BootstrapBook { const char* id; const char* chapters; };\n'
        content += 'const BootstrapBook BOOTSTRAP_BOOKS[] = {\n'
        content += ''.join(f'  {{"{mid}", BOOTSTRAP_CHAPTERS_{n}}},\n' for n, (mid, _) in enumerate(book_data))
        content += '};\n'
        bootstrap.parent.mkdir(parents=True, exist_ok=True)
        bootstrap.write_text(content, encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, help='Local manga repository; download absent files from source')
    parser.add_argument('--source', default=SOURCE)
    parser.add_argument('--output', type=Path, default=Path('manga_publish/eink'))
    parser.add_argument('--cache', type=Path, default=Path('manga_tools/.cache'))
    parser.add_argument('--bootstrap', type=Path)
    parser.add_argument('--manga')
    parser.add_argument('--chapter')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    source = args.source.rstrip('/') + '/'
    manifest_path = args.repo / 'manifest.json' if args.repo else None
    manifest = json.loads(manifest_path.read_bytes() if manifest_path and manifest_path.exists() else fetch(source + 'manifest.json'))
    args.output.mkdir(parents=True, exist_ok=True)
    chosen = [(m, c) for m in manifest['manga'] for c in m['chapters']
              if (args.all or args.manga == m['id']) and (not args.chapter or args.chapter == c['id'])]
    if args.chapter and not chosen:
        raise SystemExit('Chapter not found')
    write_catalogues(manifest, args.output, args.bootstrap)

    def build(pair):
        manga, chapter = pair
        manga_id, chapter_id = safe_id(manga['id']), safe_id(chapter['id'])
        destination = args.output / manga_id / (chapter_id + '.mgz')
        if destination.exists():
            count = validate_pack(destination)
            print(f'{manga_id}/{chapter_id}: cached, {count} screens', flush=True)
            return
        images = []
        for relative in chapter['pages']:
            if relative.startswith('/') or '..' in Path(relative).parts or '\\' in relative or ':' in relative:
                raise ValueError('Invalid image path')
            image_path = args.repo / relative if args.repo else args.cache / relative
            if not image_path.is_file():
                image_path = args.cache / relative
                image_path.parent.mkdir(parents=True, exist_ok=True)
                image_path.write_bytes(fetch(source + urllib.parse.quote(relative, safe='/')))
            images.append(image_path)
        count, total = write_pack(destination, images)
        print(f'{manga_id}/{chapter_id}: {count} screens, {total:,} bytes', flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as executor:
        list(executor.map(build, chosen))
    write_catalogues(manifest, args.output, args.bootstrap)


if __name__ == '__main__':
    main()
