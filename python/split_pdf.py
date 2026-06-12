import json
import os
import re
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.errors import FileNotDecryptedError, PdfReadError


def sanitize(s: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_.-]+', '_', s).strip('._') or 'file'


def parse_ranges(raw: str, total_pages: int):
    def resolve_page(value: str) -> int:
        token = value.strip()
        if token == '#':
            return total_pages
        try:
            page = int(token)
        except ValueError as exc:
            raise ValueError(f'Invalid page "{value}".') from exc
        if page < 1:
            raise ValueError(f'Invalid page "{value}".')
        return page

    cleaned = re.sub(r'[()]', '', raw)
    ranges = []
    for token in [t.strip() for t in re.split(r'[,+]', cleaned) if t.strip()]:
        if '-' in token:
            start, end = token.split('-', 1)
            s, e = resolve_page(start), resolve_page(end)
            if s < 1 or e < s:
                raise ValueError(f'Invalid range "{token}".')
            ranges.append((s, e))
        else:
            p = resolve_page(token)
            ranges.append((p, p))
    if not ranges:
        raise ValueError('No page ranges provided.')
    return ranges


def open_pdf(path: str) -> PdfReader:
    try:
        reader = PdfReader(path, strict=False)
    except FileNotDecryptedError:
        raise ValueError('PDF is password-protected. Remove the password before uploading.')
    except PdfReadError as exc:
        raise ValueError(f'Cannot read PDF: {exc}')
    if reader.is_encrypted:
        raise ValueError('PDF is encrypted.')
    if len(reader.pages) == 0:
        raise ValueError('PDF has no pages.')
    return reader


def split_individual(reader: PdfReader, output_dir: str, base_name: str):
    """One PDF per page, named {base_name}_page_001.pdf etc."""
    os.makedirs(output_dir, exist_ok=True)
    base = sanitize(base_name)
    outputs = []
    for i, page in enumerate(reader.pages, 1):
        writer = PdfWriter()
        writer.add_page(page)
        fname = f'{base}_page_{i:03d}.pdf'
        with open(Path(output_dir) / fname, 'wb') as fh:
            writer.write(fh)
        outputs.append({'fileName': fname, 'label': f'Page {i}'})
    return outputs


def split_by_plan(reader: PdfReader, output_dir: str, splits: list):
    """
    splits: [{name, pages, label?}]
    Each entry becomes one PDF; page ranges follow the same comma/hyphen syntax.
    """
    os.makedirs(output_dir, exist_ok=True)
    total = len(reader.pages)
    outputs = []
    for split in splits:
        name  = sanitize(str(split.get('name', 'part')))
        label = str(split.get('label', name))
        pages = str(split.get('pages', ''))
        ranges = parse_ranges(pages, total)
        writer = PdfWriter()
        for start, end in ranges:
            if end > total:
                raise ValueError(f'Range {start}-{end} exceeds PDF length ({total} pages).')
            for p in range(start - 1, end):
                writer.add_page(reader.pages[p])
        fname = f'{name}.pdf'
        with open(Path(output_dir) / fname, 'wb') as fh:
            writer.write(fh)
        outputs.append({'fileName': fname, 'label': label})
    return outputs


if __name__ == '__main__':
    if len(sys.argv) < 5:
        print('Usage: split_pdf.py <input> <output_dir> individual <base_name>', file=sys.stderr)
        print('       split_pdf.py <input> <output_dir> splits <splits_json>', file=sys.stderr)
        sys.exit(1)

    input_path, output_dir, mode, data = sys.argv[1], sys.argv[2], sys.argv[3].strip(), sys.argv[4]
    try:
        reader = open_pdf(input_path)
        if mode == 'individual':
            result = split_individual(reader, output_dir, data)
        elif mode == 'splits':
            result = split_by_plan(reader, output_dir, json.loads(data))
        else:
            raise ValueError(f'Unknown mode: {mode}')
        print(json.dumps(result))
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
