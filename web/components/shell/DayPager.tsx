import Link from 'next/link';
import { Icon } from '../ui/Icon';
import { addDays, formatDateLong } from '@/lib/time';

/** Previous / next day. Stops at `max` (default: today); IEX prices pass tomorrow once its DAM is published. */
export function DayPager({ date, today, hrefFor, max }: { date: string; today: string; hrefFor: (d: string) => string; max?: string }) {
  const last = max && max > today ? max : today;
  const atEnd = date >= last;
  const badge = date === today ? 'TODAY' : date === addDays(today, 1) ? 'TOMORROW' : null;
  return (
    <div className="eg-row ecv-pager">
      <Link className="eg-icon-btn eg-icon-btn--sm" href={hrefFor(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron-left" size={18} /></Link>
      <span className="eg-chip eg-chip--lg">
        <Icon name="calendar" size={14} />{formatDateLong(date)}
        {badge ? <span className="eg-chip eg-chip--accent ecv-today-badge">{badge}</span> : null}
      </span>
      {atEnd
        ? <span className="eg-icon-btn eg-icon-btn--sm ecv-disabled" aria-disabled="true" aria-label="Next day"><Icon name="chevron-right" size={18} /></span>
        : <Link className="eg-icon-btn eg-icon-btn--sm" href={hrefFor(addDays(date, 1))} aria-label="Next day"><Icon name="chevron-right" size={18} /></Link>}
      {date !== today ? <Link className="eg-btn eg-btn--sm eg-btn--ghost" href={hrefFor(today)}>Go to today</Link> : null}
    </div>
  );
}
