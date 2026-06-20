from __future__ import annotations

import argparse
import json
import math
import re
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import easyocr
import numpy as np
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
DEFAULT_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\animeace2_reg.ttf",
    r"C:\Windows\Fonts\comic.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


@dataclass
class TextBox:
    points: list[list[int]]
    text: str
    confidence: float

    @property
    def bounds(self) -> tuple[int, int, int, int]:
        xs = [point[0] for point in self.points]
        ys = [point[1] for point in self.points]
        return min(xs), min(ys), max(xs), max(ys)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Traduce immagini manga/webtoon da inglese a italiano creando una copia tradotta."
    )
    parser.add_argument("--input", required=True, help="Cartella sorgente con capitoli e immagini.")
    parser.add_argument("--output", required=True, help="Cartella dove salvare la versione tradotta.")
    parser.add_argument("--source-lang", default="en", help="Lingua sorgente per traduzione.")
    parser.add_argument("--target-lang", default="it", help="Lingua destinazione.")
    parser.add_argument("--ocr-lang", default="en", help="Lingua EasyOCR.")
    parser.add_argument("--min-confidence", type=float, default=0.38, help="Confidenza OCR minima.")
    parser.add_argument("--padding", type=int, default=8, help="Padding dei box tradotti.")
    parser.add_argument("--quality", type=int, default=92, help="Qualita JPEG output.")
    parser.add_argument("--limit", type=int, default=0, help="Numero massimo immagini da processare per test.")
    parser.add_argument("--overwrite", action="store_true", help="Rigenera anche immagini gia tradotte.")
    parser.add_argument("--cache", default="", help="File cache traduzioni JSON. Default: output/.translation-cache.json")
    parser.add_argument("--font", default="", help="Percorso font TTF opzionale.")
    parser.add_argument("--cpu", action="store_true", help="Forza EasyOCR su CPU.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_root = Path(args.input).expanduser().resolve()
    output_root = Path(args.output).expanduser().resolve()
    cache_path = Path(args.cache).expanduser().resolve() if args.cache else output_root / ".translation-cache.json"

    if not source_root.exists():
        raise SystemExit(f"Input non trovato: {source_root}")

    output_root.mkdir(parents=True, exist_ok=True)
    cache = load_cache(cache_path)
    translator = GoogleTranslator(source=args.source_lang, target=args.target_lang)
    reader = easyocr.Reader([args.ocr_lang], gpu=not args.cpu)
    font_path = find_font(args.font)

    images = collect_images(source_root)
    if args.limit > 0:
        images = images[: args.limit]

    print(f"Input:  {source_root}")
    print(f"Output: {output_root}")
    print(f"Immagini da processare: {len(images)}")

    for index, image_path in enumerate(images, start=1):
        relative = image_path.relative_to(source_root)
        target_path = output_root / relative
        target_path = target_path.with_suffix(".jpg")
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if target_path.exists() and not args.overwrite:
            print(f"[{index}/{len(images)}] skip {relative}")
            continue

        print(f"[{index}/{len(images)}] traduco {relative}")
        try:
            translate_image(
                image_path=image_path,
                target_path=target_path,
                reader=reader,
                translator=translator,
                cache=cache,
                font_path=font_path,
                min_confidence=args.min_confidence,
                padding=args.padding,
                quality=args.quality,
            )
        except Exception as exc:
            print(f"  ERRORE: {exc}")
            continue

        if index % 10 == 0:
            save_cache(cache_path, cache)

    save_cache(cache_path, cache)
    print("Fine.")


def collect_images(root: Path) -> list[Path]:
    return sorted(
        [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS],
        key=natural_key,
    )


def natural_key(path: Path) -> list[object]:
    parts = re.split(r"(\d+)", str(path).lower())
    return [int(part) if part.isdigit() else part for part in parts]


def translate_image(
    image_path: Path,
    target_path: Path,
    reader: easyocr.Reader,
    translator: GoogleTranslator,
    cache: dict[str, str],
    font_path: Path,
    min_confidence: float,
    padding: int,
    quality: int,
) -> None:
    image_cv = cv2.imdecode(np.fromfile(str(image_path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image_cv is None:
        raise ValueError("immagine non leggibile")

    results = reader.readtext(image_cv, paragraph=True, detail=1)
    boxes = normalize_results(results, min_confidence)

    image = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(image)

    for box in boxes:
        translated = translate_cached(translator, cache, box.text)
        if not translated:
            continue
        paint_translation(draw, image.size, box, translated, font_path, padding)

    image.save(target_path, "JPEG", quality=quality, optimize=True)


def normalize_results(results: list, min_confidence: float) -> list[TextBox]:
    boxes: list[TextBox] = []
    for item in results:
        if len(item) < 2:
            continue
        points = [[int(point[0]), int(point[1])] for point in item[0]]
        text = clean_text(str(item[1]))
        confidence = float(item[2]) if len(item) > 2 and isinstance(item[2], (float, int)) else 1.0
        if confidence < min_confidence or len(text) < 2:
            continue
        if not looks_like_dialog(text):
            continue
        boxes.append(TextBox(points=points, text=text, confidence=confidence))
    return boxes


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    text = text.replace("|", "I")
    return text.strip()


def looks_like_dialog(text: str) -> bool:
    letters = sum(char.isalpha() for char in text)
    return letters >= 2 and len(text) <= 350


def translate_cached(translator: GoogleTranslator, cache: dict[str, str], text: str) -> str:
    key = text.lower().strip()
    if key in cache:
        return cache[key]

    for attempt in range(3):
        try:
            translated = translator.translate(text)
            translated = clean_text(translated)
            cache[key] = translated
            time.sleep(0.15)
            return translated
        except Exception:
            if attempt == 2:
                return text
            time.sleep(1.0 + attempt)
    return text


def paint_translation(
    draw: ImageDraw.ImageDraw,
    image_size: tuple[int, int],
    box: TextBox,
    translated: str,
    font_path: Path,
    padding: int,
) -> None:
    left, top, right, bottom = box.bounds
    width, height = image_size
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(width, right + padding)
    bottom = min(height, bottom + padding)
    box_width = max(20, right - left)
    box_height = max(16, bottom - top)

    draw.rounded_rectangle((left, top, right, bottom), radius=8, fill=(255, 255, 255))
    font, lines = fit_text(translated, font_path, box_width - 8, box_height - 6)
    line_heights = [text_size(draw, line, font)[1] for line in lines]
    total_height = sum(line_heights) + max(0, len(lines) - 1) * 2
    y = top + max(2, (box_height - total_height) / 2)

    for line, line_height in zip(lines, line_heights):
        line_width = text_size(draw, line, font)[0]
        x = left + max(2, (box_width - line_width) / 2)
        draw.text((x, y), line, fill=(8, 8, 8), font=font)
        y += line_height + 2


def fit_text(text: str, font_path: Path, max_width: int, max_height: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    for size in range(34, 8, -1):
        font = ImageFont.truetype(str(font_path), size=size)
        approx_chars = max(4, math.floor(max_width / max(size * 0.55, 1)))
        lines = wrap_text(text, approx_chars)
        if len(lines) > 6:
            continue
        estimated_height = len(lines) * (size + 2)
        if estimated_height <= max_height:
            return font, lines

    font = ImageFont.truetype(str(font_path), size=9)
    return font, wrap_text(text, max(4, math.floor(max_width / 5)))


def wrap_text(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False) or [text]


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def find_font(custom: str) -> Path:
    candidates = [custom] if custom else []
    candidates.extend(DEFAULT_FONT_CANDIDATES)
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    raise SystemExit("Nessun font trovato. Passa --font C:\\path\\font.ttf")


def load_cache(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(path: Path, cache: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
