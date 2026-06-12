import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { spawnSync } from 'child_process';

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadsDir   = path.join(__dirname, '..', 'uploads');
const downloadsDir = path.join(__dirname, '..', 'downloads');
const pythonDir    = path.join(__dirname, '..', 'python');

const upload = multer({ dest: uploadsDir });
const python = process.env.PYTHON || 'python';

app.use(cors({ origin: true }));
app.use(express.json());
// Serve downloads with Content-Disposition: attachment so browsers always save the file
app.get('/downloads/:filename', (req: Request, res: Response) => {
  const filename = path.basename(String(req.params.filename));
  const filepath = path.join(downloadsDir, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  return res.download(filepath, filename, () => { fs.unlink(filepath, () => {}); });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'pdf-split-api' });
});

// POST /api/split-pdfs
// Body (multipart): pdf (file), recipients (JSON string of [{email, pages}])
app.post('/api/split-pdfs', upload.single('pdf'), (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' });

    const mode = String(req.body.mode || 'splits');
    fs.mkdirSync(downloadsDir, { recursive: true });

    let pythonArgs: string[];

    if (mode === 'individual') {
      const baseName = path.basename(String(req.body.baseName || 'page'), '.pdf');
      pythonArgs = [path.join(pythonDir, 'split_pdf.py'), req.file.path, downloadsDir, 'individual', baseName];
    } else {
      let splits: Array<{ name: string; pages: string; label?: string }>;
      try {
        splits = JSON.parse(String(req.body.splits || '[]'));
      } catch {
        return res.status(400).json({ error: 'splits must be valid JSON.' });
      }
      if (!splits.length) return res.status(400).json({ error: 'No splits provided.' });
      pythonArgs = [path.join(pythonDir, 'split_pdf.py'), req.file.path, downloadsDir, 'splits', JSON.stringify(splits)];
    }

    const result = spawnSync(python, pythonArgs, { encoding: 'utf8' });
    fs.unlink(req.file.path, () => {});

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'Split failed.',
        detail: result.stderr || result.stdout || 'Unknown error',
      });
    }

    const rawOutputs = JSON.parse(result.stdout.trim()) as Array<{ fileName: string; label: string }>;
    const downloads = rawOutputs.map((d) => ({
      ...d,
      url: `/downloads/${encodeURIComponent(d.fileName)}`,
    }));

    return res.json({ downloads, count: downloads.length });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected server error.', detail: String(err) });
  }
});

// POST /api/parse-schedule
// Body (multipart): schedule (PDF file)
// Returns: { recipients: [{email, pages}] }
app.post('/api/parse-schedule', upload.single('schedule'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No schedule PDF uploaded.' });
    }

    const result = spawnSync(
      python,
      [path.join(pythonDir, 'parse_schedule.py'), req.file.path],
      { encoding: 'utf8' },
    );
    fs.unlink(req.file.path, () => {});

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'Schedule parse failed.',
        detail: result.stderr || 'Unknown error',
      });
    }

    const recipients = JSON.parse(result.stdout.trim());
    return res.json({ recipients });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected server error.', detail: String(err) });
  }
});

// POST /api/merge-pdfs
// Body (JSON): { fileNames: string[], outputName?: string }
app.post('/api/merge-pdfs', (req: Request, res: Response) => {
  try {
    const { fileNames, outputName } = req.body as { fileNames: unknown; outputName?: unknown };
    if (!Array.isArray(fileNames) || fileNames.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 files to merge.' });
    }

    fs.mkdirSync(downloadsDir, { recursive: true });

    const filePaths = (fileNames as string[]).map((fn) =>
      path.join(downloadsDir, path.basename(String(fn))),
    );
    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) {
        return res.status(404).json({ error: `File not found: ${path.basename(fp)}` });
      }
    }

    const base = outputName
      ? String(outputName).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.pdf$/i, '')
      : `merged_${Date.now()}`;
    const mergedName = `${base}.pdf`;
    const mergedPath = path.join(downloadsDir, mergedName);

    const result = spawnSync(python, [path.join(pythonDir, 'merge_pdfs.py'), mergedPath, ...filePaths], { encoding: 'utf8' });

    if (result.status !== 0) {
      return res.status(500).json({ error: 'Merge failed.', detail: result.stderr || result.stdout });
    }

    return res.json({ fileName: mergedName, url: `/downloads/${encodeURIComponent(mergedName)}` });
  } catch (err) {
    return res.status(500).json({ error: 'Unexpected error.', detail: String(err) });
  }
});

app.listen(port, () => {
  console.log(`PDF split API running on http://localhost:${port}`);
});
