import Link from 'next/link';
import { Icon } from '../ui/Icon';
import { addDays, formatDateLong } from '@/lib/time';

export function DayPager({ date, today, hrefFor }: { date: string; today: string; hrefFor: (d: string) => string }) {
  const atToday = date >= today;
  return (
    <div className="eg-row ecv-pager">
      <Link className="eg-icon-btn eg-icon-btn--sm" href={hrefFor(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron-left" size={18} /></Link>
      <span className="eg-chip eg-chip--lg">
        <Icon name="calendar" size={14} />{formatDateLong(date)}
        {atToday ? <span className="eg-chip eg-chip--accent ecv-today-badge">TODAY</span> : null}
      </span>
      {atToday
        ? <span className="eg-icon-btn eg-icon-btn--sm ecv-disabled" aria-disabled="true" aria-label="Next day"><Icon name="chevron-right" size={18} /></span>
        : <Link className="eg-icon-btn eg-icon-btn--sm" href={hrefFor(addDays(date, 1))} aria-label="Next day"><Icon name="chevron-right" size={18} /></Link>}
      {!atToday ? <Link className="eg-btn eg-btn--sm eg-btn--ghost" href={hrefFor(today)}>Go to today</Link> : null}
    </div>
  );
}
