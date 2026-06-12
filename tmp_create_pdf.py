from pathlib import Path
from pypdf import PdfWriter

writer = PdfWriter()
for _ in range(3):
    writer.add_blank_page(width=72, height=72)

path = Path('tmp_sample.pdf')
with open(path, 'wb') as handle:
    writer.write(handle)

print(path.resolve())
