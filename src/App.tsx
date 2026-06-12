import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab       = 'upload' | 'split' | 'settings';
type SplitMode = 'individual' | 'ranges' | 'schedule';

type SplitPlan    = { name: string; pages: string; label: string };
type SplitDownload = { fileName: string; label: string; url: string };
type RangeRow      = { name: string; pages: string };
type AppSettings  = { apiUrl: string; autoAdvance: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = { apiUrl: '', autoAdvance: true };

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('pdf-splitter-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: AppSettings) {
  try { localStorage.setItem('pdf-splitter-settings', JSON.stringify(s)); } catch (_) { /* ignore */ }
}

function sanitizeName(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

function buildRangeSplits(rows: RangeRow[], baseName: string): SplitPlan[] {
  return rows
    .filter((r) => r.pages.trim())
    .map((r, i) => ({
      name:  r.name.trim() ? sanitizeName(r.name.trim()) : `${sanitizeName(baseName)}_part_${i + 1}`,
      pages: r.pages.trim(),
      label: r.name.trim() ? r.name.trim() : `Part ${i + 1} — pp. ${r.pages.trim()}`,
    }));
}

function buildScheduleSplits(recipients: { email: string; pages: string }[]): SplitPlan[] {
  return recipients.map((r) => ({
    name:  sanitizeName(r.email),
    pages: r.pages,
    label: r.email,
  }));
}

// ─── RangeTable ───────────────────────────────────────────────────────────────

function RangeTable({ rows, onChange }: { rows: RangeRow[]; onChange: (rows: RangeRow[]) => void }) {
  function update(i: number, field: keyof RangeRow, value: string) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function remove(i: number) { onChange(rows.filter((_, idx) => idx !== i)); }
  function add() { onChange([...rows, { name: '', pages: '' }]); }

  return (
    <div className="range-table">
      <div className="range-table-header">
        <span className="range-th">Name <span className="range-th-opt">(optional)</span></span>
        <span className="range-th">Pages</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="range-table-row">
          <input
            className="field-input"
            placeholder={`part_${i + 1}`}
            value={row.name}
            onChange={(e) => update(i, 'name', e.target.value)}
          />
          <input
            className="field-input"
            placeholder="(1-5) + (8, 10-#)"
            value={row.pages}
            onChange={(e) => update(i, 'pages', e.target.value)}
          />
          <button className="btn-icon-remove" type="button" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button className="btn-add-row" type="button" onClick={add}>+ Add row</button>
    </div>
  );
}

// ─── Download helpers ─────────────────────────────────────────────────────────

async function triggerDownload(url: string, fileName: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = obj; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(obj), 1000);
}

async function safeJson(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    const text = await res.text().catch(() => '');
    throw new Error(
      res.status === 404
        ? 'API not found — is the server running?'
        : `Server returned ${res.status} with a non-JSON response. Is the server running?\n${text.slice(0, 120)}`,
    );
  }
  return res.json();
}

async function downloadAsZip(downloads: SplitDownload[], zipName: string) {
  const zip = new JSZip();
  for (const d of downloads) {
    const res = await fetch(d.url);
    zip.file(d.fileName, await res.blob());
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const obj  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = obj;
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(obj), 1000);
}

// ─── PdfPagePreview ───────────────────────────────────────────────────────────

function PdfPagePreview({ file, onPageCount }: { file: File; onPageCount: (n: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        if (cancelled) return;
        onPageCount(pdf.numPages);
        const page = await pdf.getPage(1);
        if (cancelled || !canvasRef.current || !wrapRef.current) return;
        const w  = wrapRef.current.clientWidth || 560;
        const vp = page.getViewport({ scale: Math.min(w / page.getViewport({ scale: 1 }).width, 1.5) });
        const canvas = canvasRef.current;
        canvas.width = vp.width; canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
      } catch { if (!cancelled) setErr('Preview unavailable.'); }
    })();
    return () => { cancelled = true; };
  }, [file, onPageCount]);

  if (err) return <p className="preview-err">{err}</p>;
  return (
    <div ref={wrapRef} className="pdf-preview-wrap">
      <canvas ref={canvasRef} className="pdf-preview-canvas" />
    </div>
  );
}

// ─── DropZone ────────────────────────────────────────────────────────────────

function DropZone({
  label, hint, accept, file, onFile, icon = '📄', compact = false,
}: {
  label: string; hint: string; accept: string;
  file: File | null; onFile: (f: File) => void;
  icon?: string; compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const drop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      className={`drop-zone${over ? ' dz-over' : ''}${compact ? ' dz-compact' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input type="file" accept={accept} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {!compact && <span className="dz-icon">{icon}</span>}
      <p className="dz-title">{file ? file.name : label}</p>
      <p className="dz-hint">{file ? `${(file.size / 1024).toFixed(0)} KB — click or drop to replace` : hint}</p>
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
    </label>
  );
}

// ─── BatchFillDialog ─────────────────────────────────────────────────────────

function BatchFillDialog({
  pageCount,
  onApply,
  onClose,
}: {
  pageCount: number | null;
  onApply: (rows: RangeRow[]) => void;
  onClose: () => void;
}) {
  const [from,     setFrom]     = useState('1');
  const [perGroup, setPerGroup] = useState('');
  const [stopAt,   setStopAt]   = useState(pageCount ? String(pageCount) : '');

  const fromN = parseInt(from, 10);
  const perN  = parseInt(perGroup, 10);
  const stopN = parseInt(stopAt, 10);

  const inputsValid =
    !isNaN(fromN) && !isNaN(perN) && !isNaN(stopN) &&
    fromN >= 1 && perN >= 1 && stopN >= fromN;

  const totalPages  = inputsValid ? stopN - fromN + 1 : 0;
  const fullGroups  = inputsValid ? Math.floor(totalPages / perN) : 0;
  const remainder   = inputsValid ? totalPages % perN : 0;
  const groupCount  = inputsValid ? fullGroups + (remainder > 0 ? 1 : 0) : 0;
  const isPossible  = inputsValid && groupCount > 0;
  const isEven      = inputsValid && remainder === 0;

  const generated: RangeRow[] = [];
  if (isPossible) {
    let cur = fromN;
    while (cur <= stopN) {
      const end = Math.min(cur + perN - 1, stopN);
      generated.push({ name: '', pages: cur === end ? `${cur}` : `${cur}-${end}` });
      cur = end + 1;
    }
  }

  const showInputErr = !inputsValid && from !== '' && perGroup !== '' && stopAt !== '';

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div className="dlg dlg-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="dlg-title">Automate per page</h3>
        <p className="dlg-desc">
          Select a page range and how many pages go into each split PDF.
          The app will check if the split is possible and fill in the rows.
        </p>

        <div className="batch-fill-fields">
          <div className="batch-field">
            <label className="dlg-label">Beginning page</label>
            <input
              className="field-input" type="number" min="1" autoFocus
              placeholder="1"
              value={from} onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="batch-field">
            <label className="dlg-label">
              End page{pageCount ? ` (max ${pageCount})` : ''}
            </label>
            <input
              className="field-input" type="number" min="1"
              placeholder={pageCount ? String(pageCount) : ''}
              value={stopAt} onChange={(e) => setStopAt(e.target.value)}
            />
          </div>
          <div className="batch-field">
            <label className="dlg-label">Pages per split PDF</label>
            <input
              className="field-input" type="number" min="1"
              placeholder="e.g. 2"
              value={perGroup} onChange={(e) => setPerGroup(e.target.value)}
            />
          </div>
        </div>

        {isPossible && (
          <div className={`batch-feasibility ${isEven ? 'feasibility-ok' : 'feasibility-warn'}`}>
            <span className="feasibility-icon">{isEven ? '✓' : '⚠'}</span>
            <div>
              <strong>
                {isEven
                  ? `Splits evenly into ${groupCount} PDF${groupCount !== 1 ? 's' : ''}`
                  : `${fullGroups} full PDF${fullGroups !== 1 ? 's' : ''} + 1 partial PDF (${remainder} page${remainder !== 1 ? 's' : ''})`}
              </strong>
              <div className="feasibility-preview">
                {generated.slice(0, 4).map((r) => r.pages).join(', ')}
                {generated.length > 4 ? `, … (${generated.length} total)` : ''}
              </div>
            </div>
          </div>
        )}

        {showInputErr && (
          <p className="batch-preview batch-preview-err">
            End page must be ≥ beginning page and all values must be positive integers.
          </p>
        )}

        <div className="dlg-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm" type="button"
            disabled={!isPossible}
            onClick={() => { onApply(generated); onClose(); }}
          >
            Apply {isPossible ? `${generated.length} rows` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── UploadTab ────────────────────────────────────────────────────────────────

function UploadTab({
  pdfFile, onPdf, pageCount, onPageCount, onNext,
}: {
  pdfFile: File | null; onPdf: (f: File) => void;
  pageCount: number | null; onPageCount: (n: number) => void;
  onNext: () => void;
}) {
  return (
    <div className="page">
      <h1 className="page-title"><span className="grad">Upload</span> your PDF</h1>
      <p className="page-sub">Drop the PDF you want to split. We'll preview the first page and detect the page count.</p>

      <div className="glass-card">
        <span className="sect-label">PDF File</span>
        <DropZone
          label="Drop PDF here or click to browse" hint="Accepts .pdf files"
          accept=".pdf,application/pdf" file={pdfFile} onFile={onPdf} icon="📑"
        />
        {pdfFile && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="badge badge-cyan">✓ {pdfFile.name}</span>
            {pageCount !== null && <span className="badge badge-purple">{pageCount} pages</span>}
          </div>
        )}
        {pdfFile && (
          <div className="pdf-preview-container">
            <PdfPagePreview file={pdfFile} onPageCount={onPageCount} />
          </div>
        )}
      </div>

      <div className="row-btns">
        <button className="btn btn-primary" disabled={!pdfFile} onClick={onNext} type="button">
          Choose split method →
        </button>
      </div>
    </div>
  );
}

// ─── EmailDialog ─────────────────────────────────────────────────────────────

function EmailDialog({ files, onClose }: { files: SplitDownload[]; onClose: () => void }) {
  const [to, setTo] = useState('');

  function send() {
    files.forEach((f) => triggerDownload(f.url, f.fileName));
    const subject = files.length === 1
      ? `PDF: ${files[0].fileName}`
      : `PDFs: ${files.length} files`;
    const body = `Hi,\n\nPlease find the attached PDF file(s):\n`
      + files.map((f) => `  • ${f.fileName}`).join('\n')
      + '\n\nBest regards';
    window.open(
      `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
    onClose();
  }

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <h3 className="dlg-title">Send via Outlook</h3>
        <p className="dlg-desc">
          Files will be downloaded to your computer first. Outlook will open — attach them from your Downloads folder.
        </p>
        <div className="dlg-files">
          {files.map((f) => <div key={f.fileName} className="dlg-file">{f.fileName}</div>)}
        </div>
        <p className="dlg-label">To</p>
        <input
          className="field-input" autoFocus
          placeholder="alice@example.com, bob@example.com"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <div className="dlg-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={send}>
            ✉ Download &amp; Open Outlook
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SplitTab ────────────────────────────────────────────────────────────────

function SplitTab({
  pdfFile, pageCount, apiUrl, onBack,
}: {
  pdfFile: File | null; pageCount: number | null;
  apiUrl: string; onBack: () => void;
}) {
  const [mode, setMode]             = useState<SplitMode>('individual');
  const [rangeRows, setRangeRows]   = useState<RangeRow[]>([{ name: '', pages: '' }]);
  const [showBatchFill, setShowBatchFill] = useState(false);

  // schedule sub-state
  const [scheduleFile,       setScheduleFile]       = useState<File | null>(null);
  const [scheduleLoading,    setScheduleLoading]    = useState(false);
  const [scheduleError,      setScheduleError]      = useState('');
  const [scheduleRecipients, setScheduleRecipients] = useState<{ email: string; pages: string }[]>([]);

  // results
  const [downloads,   setDownloads]   = useState<SplitDownload[]>([]);
  const [splitLoad,   setSplitLoad]   = useState(false);
  const [splitErr,    setSplitErr]    = useState('');
  const [zipName,     setZipName]     = useState('');
  const [zipLoading,  setZipLoading]  = useState(false);

  // selection + merge + email
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [mergeLoad,  setMergeLoad]  = useState(false);
  const [emailDlg,   setEmailDlg]   = useState<SplitDownload[] | null>(null);

  const baseName = pdfFile ? pdfFile.name.replace(/\.pdf$/i, '') : 'file';
  const defaultZip = `${baseName}_splits`;

  const canSplit = !!pdfFile && (
    mode === 'individual' ||
    (mode === 'ranges'   && rangeRows.some((r) => r.pages.trim())) ||
    (mode === 'schedule' && scheduleRecipients.length > 0)
  );

  async function handleScheduleUpload(f: File) {
    setScheduleFile(f);
    setScheduleError('');
    setScheduleLoading(true);
    try {
      const form = new FormData();
      form.append('schedule', f);
      const res  = await fetch(`${apiUrl}/api/parse-schedule`, { method: 'POST', body: form });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error ?? 'Parse failed');
      if (Array.isArray(data.recipients) && data.recipients.length) {
        setScheduleRecipients(data.recipients);
      } else {
        setScheduleError('No recipients found in that PDF.');
      }
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'Could not parse schedule.');
    } finally {
      setScheduleLoading(false);
    }
  }

  async function handleSplit() {
    if (!pdfFile) return;
    setSplitLoad(true); setSplitErr(''); setDownloads([]); setSelected(new Set());
    try {
      const form = new FormData();
      form.append('pdf', pdfFile);

      if (mode === 'individual') {
        form.append('mode', 'individual');
        form.append('baseName', baseName);
      } else {
        const splits: SplitPlan[] =
          mode === 'ranges'
            ? buildRangeSplits(rangeRows, baseName)
            : buildScheduleSplits(scheduleRecipients);
        if (!splits.length) { setSplitErr('Nothing to split.'); return; }
        form.append('mode', 'splits');
        form.append('splits', JSON.stringify(splits));
      }

      const res  = await fetch(`${apiUrl}/api/split-pdfs`, { method: 'POST', body: form });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.detail ?? data.error ?? 'Split failed.');

      setDownloads(
        (data.downloads ?? []).map((d: SplitDownload) => ({
          ...d,
          url: apiUrl ? `${apiUrl}${d.url}` : d.url,
        })),
      );
    } catch (e) {
      setSplitErr(e instanceof Error ? e.message : 'Split service not responding.');
    } finally {
      setSplitLoad(false);
    }
  }

  async function handleZip() {
    setZipLoading(true);
    await downloadAsZip(downloads, zipName.trim() || defaultZip);
    setZipLoading(false);
  }

  function toggleSelect(fileName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName); else next.add(fileName);
      return next;
    });
  }

  async function handleMerge() {
    const toMerge = downloads.filter((d) => selected.has(d.fileName));
    if (toMerge.length < 2) return;
    setMergeLoad(true); setSplitErr('');
    try {
      const res = await fetch(`${apiUrl}/api/merge-pdfs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileNames: toMerge.map((d) => d.fileName) }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error ?? 'Merge failed.');
      setDownloads((prev) => [
        ...prev,
        {
          fileName: data.fileName,
          label: `Merged (${toMerge.length} files)`,
          url: apiUrl ? `${apiUrl}${data.url}` : data.url,
        },
      ]);
      setSelected(new Set());
    } catch (e) {
      setSplitErr(e instanceof Error ? e.message : 'Merge failed.');
    } finally {
      setMergeLoad(false);
    }
  }

  return (
    <div className="page">
      <h1 className="page-title"><span className="grad">Split</span></h1>
      <p className="page-sub">
        Choose how to split{pdfFile ? ` "${pdfFile.name}"` : ''}.
        {pageCount ? ` (${pageCount} pages)` : ''}
      </p>

      {/* ── Mode selector ── */}
      <div className="mode-selector glass-card">
        {([
          ['individual', 'Every Page',   `One PDF per page${pageCount ? ` — ${pageCount} files` : ''}`],
          ['ranges',     'Page Ranges',  'Define which pages go in each PDF'],
          ['schedule',   'Schedule PDF', 'Upload a PDF mapping emails to pages'],
        ] as [SplitMode, string, string][]).map(([id, label, desc]) => (
          <button
            key={id} type="button"
            className={`mode-btn${mode === id ? ' mode-btn-active' : ''}`}
            onClick={() => { setMode(id); setDownloads([]); setSplitErr(''); }}
          >
            <span className="mode-btn-label">{label}</span>
            <span className="mode-btn-desc">{desc}</span>
          </button>
        ))}
      </div>

      {/* ── Mode config ── */}
      {mode === 'individual' && pageCount !== null && (
        <div className="glass-card">
          <span className="sect-label">Summary</span>
          <p className="sect-desc">
            Will create <strong style={{ color: '#e2e8f0' }}>{pageCount} PDFs</strong>, each named{' '}
            <code style={{ color: '#67e8f9' }}>{baseName}_page_001.pdf</code> through{' '}
            <code style={{ color: '#67e8f9' }}>{baseName}_page_{String(pageCount).padStart(3, '0')}.pdf</code>.
          </p>
        </div>
      )}

      {mode === 'ranges' && (
        <div className="glass-card">
          <div className="sect-header">
            <span className="sect-label" style={{ marginBottom: 0 }}>Page ranges</span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowBatchFill(true)}>
              Automate per page
            </button>
          </div>
          <p className="sect-desc">
            Each row = one output PDF. Use <code style={{ color: '#67e8f9' }}>-</code> for ranges,{' '}
            <code style={{ color: '#67e8f9' }}>,</code> or <code style={{ color: '#67e8f9' }}>+</code> to combine,{' '}
            <code style={{ color: '#67e8f9' }}>#</code> for the last page, and{' '}
            <code style={{ color: '#67e8f9' }}>()</code> to group —{' '}
            e.g. <code style={{ color: '#67e8f9' }}>(1-5) + (8, 10-#)</code>.
          </p>
          <RangeTable rows={rangeRows} onChange={(rows) => { setRangeRows(rows); setDownloads([]); }} />
          {rangeRows.some((r) => r.pages.trim()) && (
            <p style={{ color: '#64748b', fontSize: '.82rem', marginTop: 10 }}>
              {rangeRows.filter((r) => r.pages.trim()).length} output PDF
              {rangeRows.filter((r) => r.pages.trim()).length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {mode === 'schedule' && (
        <div className="glass-card">
          <span className="sect-label">Schedule PDF</span>
          <p className="sect-desc">
            PDF with lines like <code style={{ color: '#67e8f9' }}>user@email.com: 1-5</code>.
            Pages support <code style={{ color: '#67e8f9' }}>#</code> (last page),{' '}
            <code style={{ color: '#67e8f9' }}>+</code> to merge, and{' '}
            <code style={{ color: '#67e8f9' }}>()</code> to group. You can edit pages after parsing.
          </p>
          <DropZone
            label="Drop schedule PDF here" hint="e.g. a manifest with email: pages per line"
            accept=".pdf,application/pdf" file={scheduleFile} onFile={handleScheduleUpload}
            icon="📋" compact
          />
          {scheduleLoading && (
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              <span className="spinner" /> Parsing schedule…
            </div>
          )}
          {scheduleError && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>{scheduleError}</div>
          )}
          {scheduleRecipients.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <span className="badge badge-green">{scheduleRecipients.length} recipients parsed</span>
              <div className="range-table" style={{ marginTop: 14 }}>
                <div className="range-table-header">
                  <span className="range-th">Email / Name</span>
                  <span className="range-th">Pages</span>
                  <span />
                </div>
                {scheduleRecipients.map((r, i) => (
                  <div key={i} className="range-table-row">
                    <div className="recip-email-label">{r.email}</div>
                    <input
                      className="field-input"
                      value={r.pages}
                      placeholder="(1-5) + (8, 10-#)"
                      onChange={(e) => {
                        const next = scheduleRecipients.map((x, j) =>
                          j === i ? { ...x, pages: e.target.value } : x,
                        );
                        setScheduleRecipients(next); setDownloads([]);
                      }}
                    />
                    <button
                      className="btn-icon-remove" type="button"
                      onClick={() => { setScheduleRecipients(scheduleRecipients.filter((_, j) => j !== i)); setDownloads([]); }}
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {splitErr && <div className="alert alert-error" style={{ marginTop: 16 }}>{splitErr}</div>}

      {/* ── Downloads ── */}
      {downloads.length > 0 && (
        <>
          {/* Bulk action bar */}
          <div className="bulk-bar">
            <label className="bulk-chk-all">
              <input
                type="checkbox"
                checked={selected.size === downloads.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(downloads.map((d) => d.fileName)) : new Set())
                }
              />
              <span>{selected.size > 0 ? `${selected.size} of ${downloads.length} selected` : 'Select all'}</span>
            </label>
            {selected.size > 0 && (
              <div className="bulk-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelected(new Set())}>
                  Deselect
                </button>
                <button
                  className="btn btn-ghost btn-sm" type="button"
                  disabled={mergeLoad || selected.size < 2}
                  onClick={handleMerge}
                >
                  {mergeLoad ? <><span className="spinner" /> Merging…</> : `⊕ Merge ${selected.size} into 1`}
                </button>
                <button
                  className="btn btn-ghost btn-sm" type="button"
                  onClick={() => setEmailDlg(downloads.filter((d) => selected.has(d.fileName)))}
                >
                  ✉ Email {selected.size}
                </button>
              </div>
            )}
          </div>

          <div className="dl-grid" style={{ marginTop: 12 }}>
            {downloads.map((d) => {
              const isSel = selected.has(d.fileName);
              return (
                <div
                  key={d.fileName}
                  className={`dl-card${isSel ? ' dl-card-sel' : ''}`}
                  onClick={() => toggleSelect(d.fileName)}
                  role="checkbox"
                  aria-checked={isSel}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') toggleSelect(d.fileName); }}
                >
                  <input
                    type="checkbox" className="dl-checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(d.fileName)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="dl-icon">📄</span>
                  <span className="dl-name">{d.fileName}</span>
                  <span className="dl-email">{d.label}</span>
                  <div className="dl-card-btns">
                    <button
                      className="dl-act-btn" type="button" title="Download"
                      onClick={(e) => { e.stopPropagation(); triggerDownload(d.url, d.fileName); }}
                    >⬇</button>
                    <button
                      className="dl-act-btn" type="button" title="Email via Outlook"
                      onClick={(e) => { e.stopPropagation(); setEmailDlg([d]); }}
                    >✉</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="zip-row">
            <input
              className="field-input" style={{ flex: 1 }}
              placeholder={defaultZip} value={zipName}
              onChange={(e) => setZipName(e.target.value)}
            />
            <button className="btn btn-primary" type="button" disabled={zipLoading} onClick={handleZip}>
              {zipLoading ? <><span className="spinner" /> Zipping…</> : '⬇ Download ZIP'}
            </button>
          </div>
        </>
      )}

      {/* ── Email dialog ── */}
      {emailDlg && <EmailDialog files={emailDlg} onClose={() => setEmailDlg(null)} />}

      {/* ── Batch fill dialog ── */}
      {showBatchFill && (
        <BatchFillDialog
          pageCount={pageCount}
          onApply={(rows) => { setRangeRows(rows); setDownloads([]); }}
          onClose={() => setShowBatchFill(false)}
        />
      )}

      <div className="row-btns">
        <button className="btn btn-ghost" type="button" onClick={onBack}>← Back</button>
        <button
          className="btn btn-primary" type="button"
          disabled={splitLoad || !canSplit}
          onClick={handleSplit}
        >
          {splitLoad
            ? <><span className="spinner" /> Splitting…</>
            : downloads.length ? '↺ Re-split' : '⚡ Split PDFs'}
        </button>
      </div>
    </div>
  );
}

// ─── SettingsTab ──────────────────────────────────────────────────────────────

function SettingsTab({ settings, onChange }: { settings: AppSettings; onChange: (s: AppSettings) => void }) {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...settings, [key]: value };
    onChange(next); saveSettings(next);
  }

  return (
    <div className="page">
      <h1 className="page-title"><span className="grad">Settings</span></h1>
      <p className="page-sub">Configure the PDF splitter connection and behaviour.</p>

      <div className="glass-card">
        <span className="sect-group-label">Connection</span>
        <div className="settings-row">
          <div>
            <p className="settings-label">API URL</p>
            <p className="settings-desc">Leave empty to use the built-in proxy (default). Set a full URL only when the backend is on a different host.</p>
          </div>
          <input
            className="field-input" style={{ width: 270 }}
            value={settings.apiUrl} onChange={(e) => set('apiUrl', e.target.value)}
            placeholder="empty = same origin"
          />
        </div>

        <div className="divider" />
        <span className="sect-group-label">Behaviour</span>

        <div className="settings-row">
          <div>
            <p className="settings-label">Auto-advance tabs</p>
            <p className="settings-desc">Jump to Split automatically after uploading a PDF</p>
          </div>
          <Toggle checked={settings.autoAdvance} onChange={(v) => set('autoAdvance', v)} />
        </div>

        <div className="divider" />
        <span className="sect-group-label">About</span>

        <div className="settings-row">
          <div>
            <p className="settings-label">PDF Splitter</p>
            <p className="settings-desc">React · Express · Python (pypdf · pdfjs-dist · JSZip)</p>
          </div>
          <span className="badge badge-cyan">v1.0</span>
        </div>

        <div className="settings-row">
          <div>
            <p className="settings-label">Reset to defaults</p>
            <p className="settings-desc">Restore all settings</p>
          </div>
          <button
            className="btn btn-danger btn-sm" type="button"
            onClick={() => { const d = { ...DEFAULT_SETTINGS }; onChange(d); saveSettings(d); }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: 'upload',   label: '① Upload' },
  { id: 'split',    label: '② Split' },
  { id: 'settings', label: '⚙ Settings' },
];

export default function App() {
  const [activeTab,  setActiveTab]  = useState<Tab>('upload');
  const [pdfFile,    setPdfFile]    = useState<File | null>(null);
  const [pageCount,  setPageCount]  = useState<number | null>(null);
  const [settings,   setSettings]   = useState<AppSettings>(loadSettings);

  function handlePdfUpload(f: File) {
    setPdfFile(f);
    setPageCount(null);
    if (settings.autoAdvance) setActiveTab('split');
  }

  return (
    <div className="app-root">
      <header className="topbar">
        <span className="brand">PDF Splitter</span>
        {TABS.map((t) => (
          <button
            key={t.id} type="button"
            className={`tab-btn${activeTab === t.id ? ' active' : ''}${t.id === 'settings' ? ' settings-btn' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </header>

      {activeTab === 'upload' && (
        <UploadTab
          pdfFile={pdfFile} onPdf={handlePdfUpload}
          pageCount={pageCount} onPageCount={setPageCount}
          onNext={() => setActiveTab('split')}
        />
      )}
      {activeTab === 'split' && (
        <SplitTab
          pdfFile={pdfFile} pageCount={pageCount}
          apiUrl={settings.apiUrl}
          onBack={() => setActiveTab('upload')}
        />
      )}
      {activeTab === 'settings' && (
        <SettingsTab settings={settings} onChange={setSettings} />
      )}
    </div>
  );
}
