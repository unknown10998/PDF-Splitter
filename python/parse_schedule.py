"""
Parse a schedule PDF to extract recipient emails and page ranges.

Supports PDFs from any application (Word, Acrobat, LibreOffice, etc.).
Scanned/image-only PDFs will return an empty list — no OCR is performed.

Expected text format (anywhere in the document):
  user@example.com: 1-5
  another@example.com: 6, 8-10
"""
import json
import re
import sys

from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError, PdfReadError


def parse_schedule(pdf_path: str):
    try:
        reader = PdfReader(pdf_path, strict=False)
    except FileNotDecryptedError:
        raise ValueError('Schedule PDF is password-protected.')
    except PdfReadError as exc:
        raise ValueError(f'Cannot read schedule PDF: {exc}')

    if reader.is_encrypted:
        raise ValueError('Schedule PDF is encrypted.')

    # Extract all text, tolerating pages that yield nothing (e.g. image pages)
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)

    if not text.strip():
        return []  # scanned/image PDF — caller handles empty result

    # Match: email (optional colon/dash) then page-range tokens
    pattern = (
        r'([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})'
        r'\s*[:\-]?\s*'
        r'([\d#(][\d#,+\(\)\-\s]*)'
    )
    matches = re.findall(pattern, text)

    recipients = []
    seen: set = set()
    for email, pages_raw in matches:
        # Keep page-range characters, including # for the final page, and collapse whitespace
        pages = re.sub(r'[^\d#,+()-]', '', pages_raw).strip(',+')
        if pages and email not in seen:
            seen.add(email)
            recipients.append({'email': email.strip(), 'pages': pages})

    return recipients


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python python/parse_schedule.py <schedule_pdf>', file=sys.stderr)
        sys.exit(1)

    try:
        result = parse_schedule(sys.argv[1])
        print(json.dumps(result))
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
