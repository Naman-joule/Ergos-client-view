import { href } from '@/lib/page-params';
import type { SessionUser } from '@/lib/auth';

/** Switch between the report pages the user may see; keeps the client and plant. Hidden when there's only one. */
export function ReportTabs({ user, current, client, plant }: {
  user: SessionUser; current: 'load' | 'obligation'; client: number; plant: number;
}) {
  const tabs = [
    { key: 'load', label: 'Plant load', to: href('/reports/plant-load', { client, plant }), show: user.permissions.has('view_today') },
    { key: 'obligation', label: 'IEX obligation', to: href('/market/reports', { client, plant }), show: user.permissions.has('view_iex') },
  ].filter((t) => t.show);
  if (tabs.length < 2) return null;
  return (
    <nav className="eg-seg eg-seg--glass ecv-modes" aria-label="Report">
      {tabs.map((t) => (
        <a key={t.key} href={t.to} aria-current={current === t.key ? 'true' : undefined} aria-pressed={current === t.key}>{t.label}</a>
      ))}
    </nav>
  );
}
