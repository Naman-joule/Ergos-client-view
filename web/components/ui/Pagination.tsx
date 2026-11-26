import Link from 'next/link';
import { Icon } from './Icon';
import { PAGE_SIZES, pageWindow } from '@/lib/iex-period';
import { inr } from '@/lib/format';

/** Server-rendered pagination: links only, so the URL holds the page and Back/Forward work. */
export function Pagination({ page, pages, size, total, hrefFor, unit = 'rows' }: {
  page: number; pages: number; size: number; total: number; unit?: string;
  hrefFor: (o: { page?: number; size?: number }) => string;
}) {
  const first = total ? (page - 1) * size + 1 : 0, last = Math.min(page * size, total);
  const nav = (p: number, label: string, icon: 'chevron-left' | 'chevron-right', off: boolean) => off
    ? <span className="eg-icon-btn eg-icon-btn--sm ecv-disabled" aria-disabled="true" aria-label={label}><Icon name={icon} size={16} /></span>
    : <Link className="eg-icon-btn eg-icon-btn--sm" href={hrefFor({ page: p })} aria-label={label} scroll={false}><Icon name={icon} size={16} /></Link>;
  return (
    <div className="ecv-pagination">
      <span className="ecv-pagination__count">{inr(first)}–{inr(last)} of {inr(total)} {unit}</span>
      <nav className="ecv-pagination__pages" aria-label="Pages">
        {nav(page - 1, 'Previous page', 'chevron-left', page <= 1)}
        {pageWindow(page, pages).map((p, i) => p == null
          ? <span key={`gap${i}`} className="ecv-pagination__gap" aria-hidden="true">…</span>
          : <Link key={p} href={hrefFor({ page: p })} scroll={false} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}>{p}</Link>)}
        {nav(page + 1, 'Next page', 'chevron-right', page >= pages)}
      </nav>
      <span className="ecv-pagination__size">Rows per page
        {PAGE_SIZES.map((s) => (
          <Link key={s} href={hrefFor({ size: s, page: 1 })} scroll={false} aria-current={s === size ? 'true' : undefined}>{s}</Link>
        ))}
      </span>
    </div>
  );
}
