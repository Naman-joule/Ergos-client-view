import { href } from '@/lib/page-params';
import { addDays } from '@/lib/time';

/**
 * The Energy hub's time switch: one day, or a range. Links, not client state, so the URL is the single
 * source of truth and Back/Forward work. Same control on every screen size (it scrolls sideways on phones).
 */
export function EnergyModes({ client, plant, mode, date, today }: {
  client: number; plant: number; mode: 'day' | 'last7' | 'mtd' | 'custom'; date: string; today: string;
}) {
  const base = { client, plant };
  const opts = [
    { key: 'day', label: 'Day', to: href('/energy', { ...base, date: date !== today ? date : null }) },
    { key: 'last7', label: '7 days', to: href('/energy', { ...base, preset: 'last7' }) },
    { key: 'mtd', label: 'Month to date', to: href('/energy', { ...base, preset: 'mtd' }) },
    { key: 'custom', label: 'Range', to: href('/energy', { ...base, from: addDays(date, -29), to: date }) },
  ] as const;
  return (
    <nav className="eg-seg eg-seg--glass ecv-modes" aria-label="Time range">
      {opts.map((o) => (
        <a key={o.key} href={o.to} aria-current={mode === o.key ? 'true' : undefined} aria-pressed={mode === o.key}>{o.label}</a>
      ))}
    </nav>
  );
}
