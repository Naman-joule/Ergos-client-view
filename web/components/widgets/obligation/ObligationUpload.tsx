'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const MARKETS = ['DAM', 'RTM', 'GDAM', 'HP-DAM', 'TAM'] as const;
const MAX = 4 * 1024 * 1024;

type Status = 'waiting' | 'uploading' | 'done' | 'replaced' | 'skipped' | 'failed';
interface Item { key: string; file: File; status: Status; note: string }

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Admin upload for IEX Daily Obligation Reports: pick or drop any number of PDFs; each is sent on its own
 * (the server reads the delivery date, market and portfolio from the report), with a result per file.
 */
export function ObligationUpload({ plantId, plantName }: { plantId: number; plantName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [market, setMarket] = useState<string>('auto');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const next = [...files].filter((f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf')
      .map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, status: 'waiting' as Status, note: '' }));
    const ignored = [...files].length - next.length;
    setItems((cur) => [...cur.filter((c) => c.status === 'waiting'), ...next,
      ...(ignored ? [{ key: `ign-${Date.now()}`, file: new File([], `${ignored} non-PDF file${ignored === 1 ? '' : 's'}`), status: 'skipped' as Status, note: 'Only PDFs can be uploaded.' }] : [])]);
  };
  const set = (key: string, status: Status, note: string) =>
    setItems((cur) => cur.map((c) => (c.key === key ? { ...c, status, note } : c)));

  async function run() {
    setBusy(true);
    let changed = false;
    for (const it of items.filter((i) => i.status === 'waiting')) {
      if (it.file.size > MAX) { set(it.key, 'failed', 'Too large (max 4 MB).'); continue; }
      set(it.key, 'uploading', '');
      const fd = new FormData();
      fd.set('plant', String(plantId)); fd.set('market', market); fd.set('replace', replace ? '1' : '0'); fd.set('file', it.file);
      try {
        const res = await fetch('/api/obligation-reports', { method: 'POST', body: fd });
        const body = await res.json().catch(() => ({ ok: false, error: `Server error (${res.status}).` }));
        const what = body.market && body.deliveryDate ? `${body.market} · ${fmtDate(body.deliveryDate)}` : '';
        if (body.ok) { changed = true; set(it.key, body.replaced ? 'replaced' : 'done', what + (body.tradingDate ? ` (traded ${fmtDate(body.tradingDate)})` : '')); }
        else if (body.exists) set(it.key, 'skipped', `${what}: already uploaded. Tick “Replace existing” to overwrite.`);
        else set(it.key, 'failed', body.error ?? 'Upload failed.');
      } catch {
        set(it.key, 'failed', 'Network error. Try again.');
      }
    }
    setBusy(false);
    if (changed) router.refresh();
  }

  const waiting = items.filter((i) => i.status === 'waiting').length;
  const counts = items.reduce<Record<Status, number>>((a, i) => ({ ...a, [i.status]: a[i.status] + 1 }),
    { waiting: 0, uploading: 0, done: 0, replaced: 0, skipped: 0, failed: 0 });
  const label: Record<Status, string> = { waiting: 'Ready', uploading: 'Uploading…', done: 'Uploaded', replaced: 'Replaced', skipped: 'Skipped', failed: 'Failed' };

  return (
    <div className="ecv-up">
      <div
        className={`ecv-up__drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}
      >
        <p><b>Drop IEX obligation report PDFs here</b> or{' '}
          <button type="button" className="eg-btn eg-btn--sm eg-btn--ghost" disabled={busy} onClick={() => input.current?.click()}>choose files</button></p>
        <small>For <b>{plantName}</b>. Any number of files, any file names: the delivery date, market and portfolio are read from each report.</small>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="ecv-up__opts">
        <label>Market{' '}
          <select className="eg-input ecv-up__select" value={market} disabled={busy} onChange={(e) => setMarket(e.target.value)}>
            <option value="auto">Detect from report</option>
            {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="ecv-up__check"><input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} /> Replace existing</label>
        <button type="button" className="eg-btn eg-btn--sm eg-btn--primary" disabled={busy || !waiting} onClick={run}>
          {busy ? 'Uploading…' : `Upload ${waiting || ''} file${waiting === 1 ? '' : 's'}`}
        </button>
        {items.length && !busy ? <button type="button" className="eg-btn eg-btn--sm eg-btn--ghost" onClick={() => setItems([])}>Clear list</button> : null}
        {items.length ? <span className="eg-muted ecv-up__sum">
          {[counts.done && `${counts.done} uploaded`, counts.replaced && `${counts.replaced} replaced`, counts.skipped && `${counts.skipped} skipped`, counts.failed && `${counts.failed} failed`].filter(Boolean).join(' · ')}
        </span> : null}
      </div>

      {items.length ? (
        <ul className="ecv-up__list" aria-live="polite">
          {items.map((i) => (
            <li key={i.key} data-status={i.status}>
              <span className="ecv-up__name" title={i.file.name}>{i.file.name}</span>
              <span className="ecv-up__state">{label[i.status]}</span>
              <span className="ecv-up__note">{i.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
