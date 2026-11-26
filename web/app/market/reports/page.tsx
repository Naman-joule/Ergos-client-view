import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope, resolveSelection } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { obligationMonths, obligationReports, type ObligationRow } from '@/lib/queries/obligation';
import { OBLIGATION_MARKETS, type ObligationMarket } from '@/lib/obligation';
import { obligationFtpConfigured } from '@/lib/obligation-ftp';
import { addDays, currentBlock, formatDate, istToday } from '@/lib/time';
import { href, one, type SP } from '@/lib/page-params';
import { Shell } from '@/components/shell/Shell';
import { ScopeBar } from '@/components/shell/ScopeBar';
import { ReportTabs } from '@/components/shell/ReportTabs';
import { Card } from '@/components/ui/Card';
import { Empty, Notice } from '@/components/ui/Empty';
import { Icon } from '@/components/ui/Icon';
import { ObligationUpload } from '@/components/widgets/obligation/ObligationUpload';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'IEX obligation reports' };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const kb = (b: number) => `${Math.round(b / 1024)} KB`;

export default async function ObligationReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('view_iex');
  const sp = await searchParams;
  const today = istToday();
  const asked = one(sp.month);
  const isAdmin = user.permissions.has('admin_access');

  const view = await withUser(user.id, async (q) => {
    const scope = await loadScope(q);
    const sel = resolveSelection(scope, { client: sp.client, plant: sp.plant });
    const lag = await syncLagMinutes(q);
    if (!sel) return { scope, sel: null, lag } as const;
    // Before migration 009 runs, the table doesn't exist: say so instead of failing the page.
    const [{ ready }] = await q<{ ready: boolean }>(`SELECT to_regclass('public.iex_obligation_report') IS NOT NULL AS ready`);
    if (!ready) return { scope, sel, lag, missing: true } as const;
    const months = await obligationMonths(q, sel.plant.plant_id);
    // ?month=YYYY-MM, else the newest month with reports, else this month
    const month = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : months[0]?.month ?? today.slice(0, 7);
    const rows = await obligationReports(q, sel.plant.plant_id, month);
    return { scope, sel, lag, months, month, rows } as const;
  });

  if (!view.sel) {
    return (
      <Shell user={user} page="reports" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="No plants are assigned to your account yet" icon="factory">Ask your Joulewise contact to map your plants.</Empty>
      </Shell>
    );
  }
  if ('missing' in view) {
    return (
      <Shell user={user} page="reports" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
        <Empty title="Obligation reports aren’t set up in the database yet" icon="file">
          Run db/migrations/009_obligation_reports.sql in the Supabase SQL editor, then reload this page.
        </Empty>
      </Shell>
    );
  }
  const { sel, months, month, rows } = view;
  const pageHref = (m?: string) => href('/market/reports', { client: sel.client.client_id, plant: sel.plant.plant_id, month: m });

  // month strip: every month with reports, plus the one being shown and the current month
  const strip = [...new Set([today.slice(0, 7), month, ...months.map((m) => m.month)])].sort().reverse();
  const count = new Map(months.map((m) => [m.month, m]));

  // one row per day of the month up to today, or to the latest report (a day-ahead report covers tomorrow)
  const first = `${month}-01`;
  const [yy, mm] = month.split('-').map(Number) as [number, number];
  const lastOfMonth = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const latest = rows.reduce((m, r) => (r.delivery_date > m ? r.delivery_date : m), today);
  const last = lastOfMonth < latest ? lastOfMonth : latest;
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const markets = OBLIGATION_MARKETS.filter((m) => rows.some((r) => r.market === m));
  const at = new Map<string, ObligationRow>(rows.map((r) => [`${r.delivery_date}|${r.market}`, r]));
  const covered = (m: ObligationMarket) => rows.filter((r) => r.market === m).length;
  const portfolios = [...new Set(rows.map((r) => r.portfolio_name ?? r.portfolio_code).filter(Boolean))];

  const monthStrip = (
          <nav className="ecv-obl__months" aria-label="Month">
            {strip.map((m) => (
              <a key={m} href={pageHref(m)} aria-current={m === month ? 'page' : undefined}>
                {monthLabel(m)}<small>{count.get(m) ? `${count.get(m)!.days} day${count.get(m)!.days === 1 ? '' : 's'}` : 'none'}</small>
              </a>
            ))}
          </nav>
  );

  return (
    <Shell user={user} page="reports" liveBlock={currentBlock()} syncLag={view.lag} themeMode="dark">
      {isAdmin && !obligationFtpConfigured() ? <Notice>Uploads and downloads are switched off: set OBLIGATION_FTP_URL on the server (a write account for the obligation folder only).</Notice> : null}
      <ScopeBar scope={view.scope} client={sel.client} plant={sel.plant}
        clientHref={(c) => href('/market/reports', { client: c.client_id })}
        plantHref={(p) => href('/market/reports', { client: sel.client.client_id, plant: p.plant_id })}
        controls={<ReportTabs user={user} current="obligation" client={sel.client.client_id} plant={sel.plant.plant_id} />}
        below={monthStrip} sticky={monthStrip} />

      <div className="ecv-stack">
        {isAdmin ? (
          <Card title="Upload obligation reports" sub="Admins only · files are stored on the report server by plant, year and month, one per market and delivery day">
            <ObligationUpload plantId={sel.plant.plant_id} plantName={sel.plant.name} />
          </Card>
        ) : null}

        <Card title={`Daily obligation reports · ${monthLabel(month)}`}
          sub={rows.length
            ? `${sel.plant.name}${portfolios.length ? ` · portfolio ${portfolios.join(', ')}` : ''} · ${markets.map((m) => `${m} ${covered(m)} of ${days.length} days`).join(' · ')}`
            : `${sel.plant.name} · IEX Daily Obligation Reports by delivery date`}>
          {!rows.length ? (
            <Empty title={`No obligation reports for ${monthLabel(month)}`} icon="file">
              {isAdmin ? 'Upload the PDFs from IEX above.' : 'Your Joulewise team uploads these as they arrive from IEX.'}
            </Empty>
          ) : (
            <div className="ecv-table-wrap">
              <table className="ecv-table ecv-obl">
                <thead><tr><th>Delivery date</th>{markets.map((m) => <th key={m}>{m}</th>)}</tr></thead>
                <tbody>
                  {[...days].reverse().map((d) => {
                    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return (
                      <tr key={d} className={wd === 0 || wd === 6 ? 'is-weekend' : undefined}>
                        <td>{formatDate(d)} <small className="eg-muted">{WEEKDAY[wd]}</small></td>
                        {markets.map((m) => {
                          const r = at.get(`${d}|${m}`);
                          if (!r) return <td key={m} className="ecv-obl__missing">—</td>;
                          const title = `${r.original_name} · ${kb(r.size_bytes)} · uploaded ${r.uploaded_at}${r.trading_date ? ` · traded ${formatDate(r.trading_date)}` : ''}`;
                          return (
                            <td key={m}>
                              <span className="ecv-obl__cell" title={title}>
                                <a className="ecv-sheet ecv-sheet--pdf" href={`/api/obligation-reports/file?id=${r.id}`} target="_blank" rel="noopener">
                                  <Icon name="eye" size={13} />View</a>
                                <a className="ecv-sheet" href={`/api/obligation-reports/file?id=${r.id}&download=1`} download aria-label={`Download ${m} report for ${formatDate(d)}`}>
                                  <Icon name="download" size={13} /></a>
                                {r.trading_date ? <small>traded {formatDate(r.trading_date).replace(/ \d{4}$/, '')}</small> : null}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
