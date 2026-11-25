'use client';
import { Icon } from './Icon';

/** Downloads `rows` (first row = header) as a CSV file built in the browser. */
export function CsvButton({ rows, filename, label = 'Download CSV' }: { rows: (string | number | null)[][]; filename: string; label?: string }) {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const download = () => {
    const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <button type="button" className="ecv-sheet ecv-sheet--excel ecv-csv" onClick={download}>
      <Icon name="download" size={13} />{label}
    </button>
  );
}
