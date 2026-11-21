import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '../ui/Icon';
import { Chip, LiveDot } from '../ui/Chip';
import { ThemeToggle } from './ThemeToggle';
import { iconSvg } from '@/lib/ui/icon-svg';
import { blockLabel } from '@/lib/time';
import { SYNC_STALE_MINUTES } from '@/lib/queries/sync';
import type { SessionUser } from '@/lib/auth';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '·';
}

function syncLabel(m: number | null) {
  if (m === null) return 'Not synced yet';
  if (m < 1) return 'Synced just now';
  if (m < 60) return `Synced ${Math.round(m)} min ago`;
  if (m < 48 * 60) return `Synced ${Math.round(m / 60)} h ago`;
  return `Synced ${Math.round(m / 1440)} days ago`;
}

export function Shell({ user, page, liveBlock, syncLag, themeMode, children }: {
  user: SessionUser; page: 'today' | 'savings'; liveBlock: number; syncLag: number | null;
  themeMode: 'dark' | 'light'; children: ReactNode;
}) {
  const stale = syncLag === null || syncLag > SYNC_STALE_MINUTES;
  const role = user.role === 'admin' ? 'Admin' : user.role === 'manager' ? 'Manager' : 'Client';
  return (
    <div className="eg-screen ecv-screen">
      <aside className="eg-side">
        <div className="eg-brand">
          <span className="eg-wordmark">erg<i>OS</i></span>
          <span className="eg-chip"><Icon name="shield" size={14} />{role}</span>
        </div>
        <nav className="eg-nav" aria-label="Main">
          <div className="eg-overline eg-nav__group">Monitor</div>
          {user.permissions.has('view_today') && (
            <Link className="eg-nav__item" href="/today" aria-current={page === 'today' ? 'page' : undefined}>
              <Icon name="apps" size={19} />Today
            </Link>
          )}
          {user.permissions.has('view_savings') && (
            <Link className="eg-nav__item" href="/savings" aria-current={page === 'savings' ? 'page' : undefined}>
              <Icon name="rupee" size={19} />Savings
            </Link>
          )}
          <div className="eg-overline eg-nav__group">Coming next</div>
          <span className="eg-nav__item ecv-nav-soon" aria-disabled="true"><Icon name="antenna" size={19} />IEX prices</span>
          <span className="eg-nav__item ecv-nav-soon" aria-disabled="true"><Icon name="receipt" size={19} />Billing</span>
        </nav>
        <div className="eg-side__foot"><b>Joulewise</b>Energy management platform</div>
      </aside>
      <main className="eg-main">
        <header className="eg-topbar">
          <div className="eg-crumbs">Dashboard <Icon name="chevron-right" size={14} /> <b>{page === 'today' ? 'Today' : 'Savings'}</b></div>
          <div className="eg-topbar__end">
            <Chip lg><LiveDot />Live · {blockLabel(liveBlock)}</Chip>
            <Chip lg tone={stale ? 'warning' : 'default'} title="Data is copied from ergOS every 15 minutes">
              <Icon name="clock" size={14} />{syncLabel(syncLag)}
            </Chip>
            <ThemeToggle moonSvg={iconSvg('moon', 18)} defaultMode={themeMode} />
            <form method="post" action="/logout">
              <button className="eg-icon-btn eg-icon-btn--sm" type="submit" aria-label="Sign out" title="Sign out">
                <Icon name="arrow-right" size={18} />
              </button>
            </form>
            <span className="eg-avatar eg-avatar--lg" title={`${user.name} · ${user.email}`}>{initials(user.name)}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
