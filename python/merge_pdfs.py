import json
import os
import sys

from pypdf import PdfReader, PdfWriter


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Usage: merge_pdfs.py <output> <file1> <file2> ...', file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]
    input_paths = sys.argv[2:]

    try:
        writer = PdfWriter()
        for p in input_paths:
            reader = PdfReader(p, strict=False)
            for page in reader.pages:
                writer.add_page(page)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'wb') as fh:
            writer.write(fh)
        print(json.dumps({'fileName': os.path.basename(output_path)}))
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
