import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '../ui/Icon';
import { ThemeToggle } from './ThemeToggle';
import { LiveRefresh } from './LiveRefresh';
import { NavGroup } from './NavGroup';
import { iconSvg } from '@/lib/ui/icon-svg';
import { blockEnd } from '@/lib/time';
import type { SessionUser } from '@/lib/auth';
import { ago, timeState } from '@/lib/time-state';

export type Page = 'energy' | 'savings' | 'billing' | 'prices' | 'reports' | 'load';
const TITLES: Record<Page, string> = { energy: 'Energy', savings: 'Savings', billing: 'Billing & costing', prices: 'IEX prices', reports: 'IEX obligation reports', load: 'Plant load report' };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '·';
}

/**
 * App frame. One <nav>, three presentations (CSS only):
 *   laptop ≥ 1180  sidebar with labels
 *   tablet 600–1179  72 px icon rail
 *   phone ≤ 599  bottom tab bar in thumb reach
 * Five destinations: Energy, Savings, Billing, IEX prices, and Reports, a group with its pages (Plant load, IEX obligation).
 * The top bar carries the page title and ONE time badge (live / delayed / stale). A stale sync also opens the
 * reserved notice slot under the top bar; the slot is always in the layout, so nothing below it moves.
 */
export function Shell({ user, page, liveBlock, syncLag, themeMode, live = false, dataTo, children }: {
  user: SessionUser; page: Page; liveBlock: number; syncLag: number | null;
  themeMode: 'dark' | 'light';
  /** the selected plant's latest meter reading, IST 'YYYY-MM-DD HH:MM': the badge then shows how fresh the plant's data is */
  dataTo?: string | null; live?: boolean; children: ReactNode;
}) {
  const state = timeState(syncLag);
  const role = user.role === 'admin' ? 'Admin' : user.role === 'manager' ? 'Manager' : 'Client';
  const items: { page: Page; href: string; icon: Parameters<typeof Icon>[0]['name']; label: string; show: boolean }[] = [
    { page: 'energy', href: '/energy', icon: 'bolt', label: 'Energy', show: user.permissions.has('view_today') },
    { page: 'savings', href: '/savings', icon: 'rupee', label: 'Savings', show: user.permissions.has('view_savings') },
    { page: 'billing', href: '/billing', icon: 'receipt', label: 'Billing', show: user.permissions.has('view_billing') },
    { page: 'prices', href: '/market/prices', icon: 'antenna', label: 'IEX prices', show: user.permissions.has('view_iex') },
  ];
  // Reports: a group with its own pages, each behind its own permission
  const reports = [
    { page: 'load' as Page, href: '/reports/plant-load', label: 'Plant load', show: user.permissions.has('view_today') },
    { page: 'reports' as Page, href: '/market/reports', label: 'IEX obligation', show: user.permissions.has('view_iex') },
  ].filter((r) => r.show);
  // The badge answers "how fresh is what I'm looking at?". With a plant's meter data (dataTo) that's the time of
  // its latest reading: a logger that uploads once a day is behind even when the sync is healthy. A stale sync
  // still wins, since then nothing is arriving at all.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dataAge = dataTo ? (Date.now() - Date.parse(`${dataTo.replace(' ', 'T')}:00+05:30`)) / 60_000 : null;
  const dataLabel = dataTo ? `${Number(dataTo.slice(8, 10))} ${MON[Number(dataTo.slice(5, 7)) - 1]}, ${dataTo.slice(11)}` : '';
  const badgeState = state === 'stale' || dataAge == null ? state : dataAge <= 45 ? 'live' : 'delayed';
  const badge = state === 'stale'
    ? { text: syncLag === null ? 'Not synced' : `Stale · ${ago(syncLag)}`, title: 'Data has not been synced from ergOS for over 90 minutes.' }
    : dataAge != null
      ? dataAge <= 45
        ? { text: `Live · ${dataTo!.slice(11)}`, title: `Meter data up to ${dataLabel} IST, ${ago(Math.max(1, dataAge))}.` }
        : { text: `Data to ${dataLabel}`, title: `The plant's latest meter reading is from ${dataLabel} IST (${ago(dataAge)}). Its data logger may upload once a day; newer readings appear when it does.` }
      : state === 'live'
        ? { text: `Live · ${blockEnd(liveBlock)}`, title: `Current block B${liveBlock}, ending ${blockEnd(liveBlock)} IST. Data synced ${syncLag != null ? ago(syncLag) : ''}.` }
        : { text: `Delayed · ${ago(syncLag!)}`, title: `The last sync from ergOS was ${ago(syncLag!)}. It normally runs every 15 minutes.` };
  return (
    <div className="eg-screen ecv-screen" data-page={page}>
      <aside className="eg-side ecv-side">
        <div className="eg-brand">
          <span className="eg-wordmark">erg<i>OS</i></span>
          <span className="eg-chip ecv-side__role"><Icon name="shield" size={14} />{role}</span>
        </div>
        <nav className="eg-nav ecv-nav" aria-label="Main">
          {items.filter((i) => i.show).map((i) => (
            <Link key={i.page} className="eg-nav__item ecv-nav__item" href={i.href} aria-current={page === i.page ? 'page' : undefined} title={i.label}>
              <Icon name={i.icon} size={19} /><span className="ecv-nav__label">{i.label}</span>
            </Link>
          ))}
          {reports.length > 1 ? (
            <NavGroup label="Reports" icon={<Icon name="file" size={19} />} chevron={<Icon name="chevron-down" size={16} />}
              current={reports.some((r) => r.page === page)}
              items={reports.map((r) => ({ href: r.href, label: r.label, current: r.page === page }))} />
          ) : reports.length === 1 ? (
            <Link className="eg-nav__item ecv-nav__item" href={reports[0]!.href} aria-current={page === reports[0]!.page ? 'page' : undefined} title={reports[0]!.label}>
              <Icon name="file" size={19} /><span className="ecv-nav__label">Reports</span>
            </Link>
          ) : null}
        </nav>
        <div className="eg-side__foot ecv-side__foot"><b>Joulewise</b>Energy management platform</div>
      </aside>
      <main className="eg-main" id="main">
        <header className="eg-topbar ecv-topbar">
          <h1 className="ecv-title">{TITLES[page]}</h1>
          <div className="eg-topbar__end">
            <span className={`ecv-badge ecv-badge--${badgeState}`} role="status" aria-live="polite" title={badge.title}>
              <span className="ecv-badge__dot" aria-hidden="true" />{badge.text}
            </span>
            <ThemeToggle moonSvg={iconSvg('moon', 18)} defaultMode={themeMode} />
            <form method="post" action="/logout">
              <button className="eg-icon-btn eg-icon-btn--sm" type="submit" aria-label="Sign out" title="Sign out">
                <Icon name="arrow-right" size={18} />
              </button>
            </form>
            <span className="eg-avatar eg-avatar--lg ecv-avatar" title={`${user.name} · ${user.email}`}>{initials(user.name)}</span>
          </div>
        </header>
        <div className={`ecv-slot${state === 'stale' ? ' is-open' : ''}`} aria-hidden={state !== 'stale'}>
          {state === 'stale' ? (
            <div className="ecv-notice ecv-notice--warning ecv-slot__inner">
              {syncLag === null ? 'Nothing has been synced from ergOS yet.' : `Data is stale: the last sync from ergOS was ${ago(syncLag)}.`} Figures stop at the last synced block.
            </div>
          ) : null}
        </div>
        {children}
      </main>
      {live ? <LiveRefresh /> : null}
    </div>
  );
}
