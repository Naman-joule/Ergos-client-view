import type React from 'react';
import type { SavingsWidget } from '@/lib/dashboard/schema';
import { CHARGE_COLUMNS, CHARGE_GROUPS, type Period, type SavingsData, type SavingsRow } from '@/lib/queries/savings';
import { REPORT_KINDS, locateReport, parseDatedName, type ReportKind } from '@/lib/reports';
import type { PlantRow } from '@/lib/queries/scope';
import { compact, inr, pct, rate as fmtRate, rupeeParts, rupees } from '@/lib/format';
import { formatDate, formatDayMonth, formatRange, formatWeekday } from '@/lib/time';
import type { SeriesKey } from '@/lib/ui/ergos';
import { Folder, Sheet } from '../../ui/Folder';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { Track } from '../../ui/Track';
import { Card } from '../../ui/Card';
import { Empty } from '../../ui/Empty';
import { StatTile } from '../../ui/StatTile';
import { SavingsChart } from '../../charts/SavingsChart';
import { Heatmap } from '../../charts/Heatmap';

interface Ctx { data: SavingsData; plant: PlantRow; period: Period }

const rate4 = (v: number | null) => (v === null ? '—' : `₹${v.toFixed(4)} / kWh`);

function NoRows({ title, ctx }: { title: string; ctx: Ctx }) {
  return (
    <Card title={title} sub={`${ctx.plant.name} · ${formatRange(ctx.period.from, ctx.period.to)}`}>
      <Empty title="No savings statements in this period" icon="receipt">Daily statements appear here once they’re final, usually the day after trading.</Empty>
    </Card>
  );
}

// ---------------------------------------------------------------------------- folder
function SavingsFolder({ data, plant, period, title }: Ctx & { title?: string }) {
  const t = data.totals;
  const { whole, paise } = rupeeParts(t.savings);
  const below = t.percentBelow;
  return (
    <Folder sheets={<>
      <Sheet kicker="Volume">Cleared<b>{inr(t.volumeKwh)} kWh</b><div className="ecv-sheet-gap">Trade days</div><b>{t.tradeDays}</b></Sheet>
      <Sheet kicker="Benchmark">DISCOM, ToD weighted<b>{rate4(t.benchmarkRate)}</b><div className="ecv-sheet-gap">Basis</div><b>Grid tariff</b></Sheet>
      <Sheet kicker="IEX landed">Average<b>{rate4(t.landedRate)}</b><div className="ecv-sheet-gap">Includes</div><b>STU, CTU, CSS, ED, losses</b></Sheet>
    </>}>
      <div className="eg-folder__head">
        <h2 className="eg-folder__title">{title ?? 'Savings'}</h2>
        <p className="eg-folder__sub"><span className="ecv-nowrap">{plant.name}</span><br /><span className="ecv-nowrap">{formatRange(period.from, period.to)}</span></p>
      </div>
      {data.rows.length === 0 ? (
        <div className="ecv-folder-empty"><b>No savings statements in this period.</b><span>Pick another range above.</span></div>
      ) : (
        <div className="ecv-sv-hero">
          <div>
            <div className="eg-overline ecv-on-folder-muted">Total net savings</div>
            <div className="ecv-big ecv-big--money">{whole}<span>{paise}</span></div>
          </div>
          {below !== null ? (
            <Chip lg tone={below < 0 ? 'warning' : 'default'}>
              <Icon name="arrow-up" size={14} />{pct(Math.abs(below))} {below >= 0 ? 'below' : 'above'} DISCOM benchmark
            </Chip>
          ) : null}
        </div>
      )}
      <Track value={t.landedRate && t.benchmarkRate ? t.landedRate / t.benchmarkRate : 0}
        left={`Landed ${t.landedRate !== null ? fmtRate(t.landedRate) : '—'}`} leftNote="What you paid via IEX"
        right={`Benchmark ${t.benchmarkRate !== null ? fmtRate(t.benchmarkRate) : '—'}`} rightNote={t.estimatedDays + t.impliedDays ? `What the grid would have cost · ${t.estimatedDays + t.impliedDays} day${t.estimatedDays + t.impliedDays === 1 ? "" : "s"} ≈` : "What the grid would have cost"} />
    </Folder>
  );
}

// ---------------------------------------------------------------------------- tiles
function SavingsTiles({ data, period, tiles }: Ctx & { tiles: readonly string[] }) {
  const t = data.totals;
  const range = formatRange(period.from, period.to).replace(/ \d{4}$/, '');
  const render = (k: string) => {
    switch (k) {
      case 'volume': return <StatTile key={k} series="iex" label="Volume cleared" icon="bolt" date={range} value={inr(t.volumeKwh)} unit="kWh"
        foot={`${t.tradeDays} trade day${t.tradeDays === 1 ? '' : 's'}`} footChip={<Chip>{inr(t.volumeKwh / 1000, 2)} MWh</Chip>} />;
      case 'landed': return <StatTile key={k} series="gov" label="Avg landed tariff" icon="trend" date="Weighted by volume"
        value={t.landedRate !== null ? `₹${t.landedRate.toFixed(4)}` : '—'} unit="/ kWh" foot="Includes STU, CTU, CSS, ED and losses" />;
      case 'benchmark': return <StatTile key={k} series="grid" label="Grid benchmark" icon="shield" date="DISCOM"
        value={t.benchmarkRate !== null ? `₹${t.benchmarkRate.toFixed(4)}` : '—'} unit="/ kWh" foot={t.estimatedDays + t.impliedDays ? `ToD weighted · ${t.estimatedDays + t.impliedDays} day${t.estimatedDays + t.impliedDays === 1 ? "" : "s"} ≈` : "ToD weighted baseline"} />;
      case 'savings': return <StatTile key={k} series="iex" label="Net savings" icon="rupee" date={range}
        value={rupees(t.savings)} foot={t.best ? `Best day ${formatDayMonth(t.best.trade_date)}` : '—'} />;
      case 'percent_below': return <StatTile key={k} series="solar" label="Below benchmark" icon="arrow-up" date={range}
        value={t.percentBelow !== null ? pct(t.percentBelow) : '—'} foot="Savings ÷ grid cost" />;
      default: return null;
    }
  };
  return <div className={'ecv-tiles ecv-tiles--stack' + (tiles.length > 3 ? ' ecv-tiles--2col' : '')}>{tiles.map(render)}</div>;
}

// ---------------------------------------------------------------------------- daily chart
function SavingsDaily({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Daily net savings and volume';
  if (!data.rows.length) return <NoRows title={head} ctx={{ data, plant, period }} />;
  const oneMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  const labels = data.rows.map((r) => (oneMonth ? String(Number(r.trade_date.slice(8))) : `${Number(r.trade_date.slice(8))}/${Number(r.trade_date.slice(5, 7))}`));
  const savings = data.rows.map((r) => Math.max(0, r.net_savings_per_day || 0));      // negative days drawn as 0
  const volume = data.rows.map((r) => r.volume_cleared_kwh || 0);
  const best = data.totals.best;
  return (
    <Card title={head}
      sub={best ? `Best day ${formatDayMonth(best.trade_date)} · ${rupees(best.net_savings_per_day)} saved on ${inr(best.volume_cleared_kwh)} kWh` : undefined}
      actions={<>
        {data.totals.negativeDays > 0 ? <Chip tone="warning">{data.totals.negativeDays} day{data.totals.negativeDays === 1 ? '' : 's'} above benchmark, drawn as ₹0</Chip> : null}
        <div className="eg-legend">
          <span><span className="eg-swatch" data-series="iex" />Net savings (₹)</span>
          <span><span className="eg-swatch ecv-swatch-line" data-series="grid" />Volume cleared (kWh)</span>
        </div>
      </>}>
      <SavingsChart labels={labels} savings={savings} volume={volume} height={320}
        days={data.rows.map((r) => ({
          label: formatWeekday(r.trade_date), savings: r.net_savings_per_day || 0, volume: r.volume_cleared_kwh || 0,
          landed: r.avg_landed_iex_tariff, grid: r.avg_grid_tariff, pct: r.percent_below_grid, locked: r.is_locked, estimated: !!r.benchmark_estimated,
        }))} />
    </Card>
  );
}

// ---------------------------------------------------------------------------- charges
// Where the landed cost goes, in two clearly separate parts:
//   1. what was paid (₹): the exchange energy, then the charges on top of it, grouped by what they pay for;
//   2. what was lost (kWh): energy bought on the exchange that the networks lose before it reaches the plant.
//      Losses aren't a separate payment: they're energy paid for in (1) that never arrives, which raises the
//      price of each kWh that does.
const CHARGE_LABEL = Object.fromEntries(CHARGE_COLUMNS) as Record<string, string>;
const GROUP_SERIES: SeriesKey[] = ['grid', 'wind', 'demand', 'solar'];

function CostRow({ series, name, value, whole, note }: { series: SeriesKey; name: string; value: number; whole: number; note: string }) {
  const share = whole ? Math.max(0, Math.min(1, value / whole)) : 0;
  return (
    <div className="ecv-costs__row" data-series={series} style={{ '--share': `${(share * 100).toFixed(1)}%` } as React.CSSProperties}>
      <span className="ecv-costs__name">{name}</span>
      <span className="ecv-costs__val"><b>{rupees(value)}</b><small>{pct(share, 1)}</small></span>
      <span className="ecv-costs__bar" aria-hidden="true"><span /></span>
      <span className="ecv-costs__note">{note}</span>
    </div>
  );
}

function SavingsCharges({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Where the landed cost goes';
  if (!data.rows.length) return <NoRows title={head} ctx={{ data, plant, period }} />;
  const t = data.totals;
  const whole = t.iexCost || 1;
  const L = t.losses;
  const lostKwh = L.ctuKwh + L.stuKwh + L.distKwh;
  const deliveredKwh = L.clearedKwh - lostKwh;
  const maxLoss = Math.max(L.ctuKwh, L.stuKwh, L.distKwh);
  const energyRate = t.volumeKwh ? t.energy / t.volumeKwh : null;              // ₹ per cleared kWh of energy
  const showUnaccounted = Math.abs(t.unaccounted) > Math.max(1, t.iexCost * 0.005);
  const lossRows = [
    { key: 'ctu', name: 'Inter-state network (CTU)', kwh: L.ctuKwh, pct: L.ctuPct },
    { key: 'stu', name: 'State network (STU)', kwh: L.stuKwh, pct: L.stuPct },
    { key: 'dist', name: 'DISCOM network (distribution)', kwh: L.distKwh, pct: L.distPct },
  ];
  return (
    <Card title={head} sub={`${rupees(t.iexCost)} landed cost for ${inr(t.volumeKwh)} kWh bought · ${formatRange(period.from, period.to)}`}>
      <section className="ecv-costs" aria-label="What was paid">
        <h4 className="ecv-costs__head"><span className="ecv-costs__kind ecv-costs__kind--paid">Paid · ₹</span>What the landed cost is made of</h4>
        <div className="ecv-costs__rows">
          <CostRow series="iex" name="Exchange energy" value={t.energy} whole={whole}
            note={t.energyDerivedDays > 0
              ? `The power itself, at the exchange clearing price. The statement didn’t itemise it on ${t.energyDerivedDays} day${t.energyDerivedDays === 1 ? '' : 's'}; there it’s the landed cost less the charges below.`
              : 'The power itself, at the exchange clearing price'} />
          {CHARGE_GROUPS.map((g, i) => {
            const items = g.items.map((k) => ({ label: CHARGE_LABEL[k]!, v: t.charges[k] }));
            const sum = items.reduce((a, x) => a + x.v, 0);
            if (sum === 0) return null;
            return <CostRow key={g.key} series={GROUP_SERIES[i]!} name={g.label} value={sum} whole={whole}
              note={items.length > 1 ? `${g.hint}: ${items.filter((x) => x.v).map((x) => `${x.label} ${rupees(x.v)}`).join(' · ')}` : g.hint} />;
          })}
          {showUnaccounted
            ? <p className="ecv-costs__note ecv-costs__note--warn">{rupees(Math.abs(t.unaccounted))} of the landed cost {t.unaccounted > 0 ? 'isn’t itemised in the daily statements' : 'is itemised twice in the daily statements'} (energy + charges {t.unaccounted > 0 ? 'fall short of' : 'exceed'} the landed cost).</p> : null}
        </div>
      </section>

      <section className="ecv-costs ecv-costs--loss" aria-label="What was lost">
        <h4 className="ecv-costs__head"><span className="ecv-costs__kind ecv-costs__kind--loss">Lost · kWh</span>Energy lost on the way to the plant</h4>
        {L.days === 0 ? (
          <p className="ecv-costs__note">The daily statements for this period don’t record loss rates.</p>
        ) : (
          <>
            <p className="ecv-costs__flow">
              <b>{inr(L.clearedKwh)} kWh</b> bought <span aria-hidden="true">→</span> <b>{inr(lostKwh)} kWh</b> lost
              ({pct(L.clearedKwh ? lostKwh / L.clearedKwh : 0, 1)}) <span aria-hidden="true">→</span> <b>{inr(deliveredKwh)} kWh</b> delivered
            </p>
            <div className="ecv-costs__losses">
              {lossRows.map((r) => (
                <div key={r.key} className="ecv-costs__loss" style={{ '--share': `${maxLoss ? (r.kwh / maxLoss) * 100 : 0}%` } as React.CSSProperties}>
                  <span>{r.name}{r.pct != null ? <small> · {r.pct}% loss</small> : null}</span>
                  <b>{inr(r.kwh)} kWh</b>
                  <span className="ecv-costs__lossbar" aria-hidden="true"><span /></span>
                </div>
              ))}
            </div>
            <p className="ecv-costs__note">
              Not an extra payment: this energy is inside the exchange energy above
              {energyRate != null ? <> (worth about {rupees(lostKwh * energyRate)})</> : null}, paid for but never delivered.
              {t.volumeKwh && deliveredKwh > 0 && L.clearedKwh === t.volumeKwh
                ? <> So each delivered kWh costs {fmtRate(t.iexCost / deliveredKwh)}, against {fmtRate(t.iexCost / t.volumeKwh)} per kWh bought.</> : null}
              {L.days < data.rows.length ? <> Loss rates recorded on {L.days} of {data.rows.length} days.</> : null}
            </p>
          </>
        )}
      </section>
    </Card>
  );
}

// ---------------------------------------------------------------------------- ToD split
function SavingsTod({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Time of day split';
  const sub = `Cleared blocks priced at the DISCOM ToD tariff for ${plant.voltage_level?.replace('_kv', ' kV') ?? 'the plant'} + FPPCA`;
  if (!data.tod.length) {
    return <Card title={head} sub={sub} actions={<Chip tone="warning">Indicative</Chip>}>
      <Empty title="No cleared blocks with a matching ToD tariff in this period" icon="clock" />
    </Card>;
  }
  const total = data.tod.reduce((a, r) => a + r.kwh, 0) || 1;
  return (
    <Card title={head} sub={sub} actions={<Chip tone="warning">Indicative</Chip>}>
      <div className="ecv-table-wrap">
        <table className="ecv-table">
          <thead><tr><th>ToD</th><th className="num">Volume</th><th className="num">Landed</th><th className="num">Grid rate</th><th className="num">Savings (indicative)</th></tr></thead>
          <tbody>
            {data.tod.map((r) => (
              <tr key={r.tod_type}>
                <td>{r.tod_type ? r.tod_type.charAt(0) + r.tod_type.slice(1).toLowerCase().replace('offpeak', 'off-peak') : '—'}</td>
                <td className="num">{inr(r.kwh)} kWh<small>{pct(r.kwh / total, 1)}</small></td>
                <td className="num">{r.kwh ? fmtRate(r.landed / r.kwh) : '—'}</td>
                <td className="num">{r.kwh ? fmtRate(r.grid / r.kwh) : '—'}</td>
                <td className={'num' + (r.grid - r.landed < 0 ? ' neg' : '')}>{rupees(r.grid - r.landed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="eg-card__sub ecv-footnote">Indicative: before electricity duty, and not the locked daily statement figures.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------- profile
function SavingsProfile({ data, plant, period, days, title }: Ctx & { days: number; title?: string }) {
  const head = title ?? '96-block profile';
  const sub = `Cleared kW per 15-minute block · last ${days} days to ${formatDate(period.to)}`;
  if (!data.heat.length) return <Card title={head} sub={sub}><Empty title="No cleared blocks in these days" icon="layers" /></Card>;
  const max = Math.max(...data.heat.flatMap((r) => r.values));
  return (
    <Card title={head} sub={sub} actions={<div className="eg-legend"><span>0 kW</span><span className="ecv-hm-scale" /><span>{inr(Math.round(max))} kW</span></div>}>
      <Heatmap rows={data.heat.map(({ label, values }) => ({ label, values }))} max={max} />
    </Card>
  );
}

// ---------------------------------------------------------------------------- savings sheets
// ergOS makes one Excel savings sheet, one Word statement and one ZIP bundle per period (e.g. 1–31 Oct) and a
// PDF trade report per day. The period files appear once in the table header; each row has its day's PDF.
// Files on the report server download through /api/reports, which re-checks access; web links open directly.
const PERIOD_KINDS: ReportKind[] = ['excel', 'docx', 'zip'];

function sheetHref(row: SavingsRow, plantId: number, k: ReportKind): { href: string; external: boolean } | null {
  const loc = locateReport(row[REPORT_KINDS[k].column]);
  if (!loc) return null;
  return loc.via === 'url' ? { href: loc.url, external: true }
    : { href: `/api/reports?plant=${plantId}&date=${row.trade_date}&kind=${k}`, external: false };
}

function SheetButton({ k, href, external, children, title }: { k: ReportKind; href: string; external: boolean; children: React.ReactNode; title: string }) {
  return (
    <a className={'ecv-sheet ecv-sheet--' + k} href={href} title={title}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : { download: '' })}>
      <Icon name="download" size={12} />{children}
    </a>
  );
}

/** Period files in the selected range: one button per distinct file, labelled with the period it covers. */
function PeriodSheets({ rows, plantId }: { rows: SavingsRow[]; plantId: number }) {
  const seen = new Map<string, { k: ReportKind; row: SavingsRow; label: string }>();
  for (const k of PERIOD_KINDS) {
    for (const r of [...rows].reverse()) {                 // latest row first: its path is the most current
      const stored = r[REPORT_KINDS[k].column];
      if (!stored || !locateReport(stored)) continue;
      const d = parseDatedName(stored.split('/').pop() ?? '');
      const key = d ? `${k}:${d.prefix}:${d.from.slice(0, 7)}` : `${k}:${stored}`;   // one per kind and month
      if (seen.has(key)) continue;
      // label by month: the stored name may be an older range than the file now on the server
      const span = d ? new Date(`${d.from}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
      seen.set(key, { k, row: r, label: `${REPORT_KINDS[k].label}${span ? ' · ' + span : ''}` });
    }
  }
  if (!seen.size) return null;
  return (
    <span className="ecv-sheets ecv-sheets--period" aria-label="Savings sheets for this period">
      {[...seen.values()].map(({ k, row, label }) => {
        const h = sheetHref(row, plantId, k)!;
        return <SheetButton key={label} k={k} {...h} title={`${REPORT_KINDS[k].label} for the period`}>{label}</SheetButton>;
      })}
    </span>
  );
}

function DayPdf({ row, plantId }: { row: SavingsRow; plantId: number }) {
  const h = sheetHref(row, plantId, 'pdf');
  if (!h) return <span className="eg-muted">—</span>;
  return <SheetButton k="pdf" {...h} title={`IEX trade report · ${formatDate(row.trade_date)}`}>PDF</SheetButton>;
}

// ---------------------------------------------------------------------------- table
function SavingsTable({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Daily statement';
  if (!data.rows.length) return <NoRows title={head} ctx={{ data, plant, period }} />;
  const t = data.totals;
  const provisional = data.rows.filter((r) => !r.is_locked).length;
  return (
    <Card title={head} sub={`${plant.name} · ${formatRange(period.from, period.to)} · locked figures are final`}
      actions={<>
        <PeriodSheets rows={data.rows} plantId={plant.plant_id} />
        {t.allLocked ? <Chip tone="accent"><Icon name="check" size={13} />Locked</Chip> : <Chip tone="warning">Provisional · {provisional} day{provisional === 1 ? '' : 's'}</Chip>}
      </>}>
      <div className="ecv-table-wrap">
        <table className="ecv-table">
          <thead>
            <tr>
              <th>Date</th><th className="num">Volume (kWh)</th><th className="num" title="IEX landed tariff, ₹/kWh">Landed ₹/kWh</th><th className="num">IEX cost (₹)</th>
              <th className="num" title="Grid (DISCOM) benchmark, ₹/kWh">Benchmark ₹/kWh</th><th className="num">Grid cost (₹)</th><th className="num">Net savings (₹)</th>
              <th className="num">Below grid</th><th className="ecv-sticky-end">Trade report</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              return (
                <tr key={r.trade_date}>
                  <td className="nowrap">{formatDate(r.trade_date)}{r.is_locked ? null : <> <Chip tone="warning">Provisional</Chip></>}</td>
                  <td className="num">{inr(r.volume_cleared_kwh)}</td>
                  <td className="num">{r.avg_landed_iex_tariff !== null ? r.avg_landed_iex_tariff.toFixed(4) : '—'}</td>
                  <td className="num">{inr(r.iex_total_cost, 2)}</td>
                  <td className="num" title={r.benchmark_source === 'implied' ? 'Provisional: worked back from the day’s savings while its grid cost is being finalised' : r.benchmark_estimated ? 'Provisional: estimated from the DISCOM ToD tariff until the day’s statement is final' : undefined}>
                    {r.benchmark_estimated ? <span className="ecv-est">≈</span> : null}{r.avg_grid_tariff !== null ? r.avg_grid_tariff.toFixed(4) : '—'}</td>
                  <td className="num">{r.benchmark_estimated ? <span className="ecv-est">≈</span> : null}{inr(r.grid_total_cost, 2)}</td>
                  <td className={'num' + (r.net_savings_per_day < 0 ? ' neg' : '')}>{r.benchmark_estimated && r.benchmark_source !== 'implied' ? <span className="ecv-est">≈</span> : null}{inr(r.net_savings_per_day, 2)}</td>
                  <td className="num">{r.percent_below_grid !== null ? `${r.percent_below_grid.toFixed(2)}%` : '—'}</td>
                  <td className="ecv-sticky-end"><DayPdf row={r} plantId={plant.plant_id} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total · {t.tradeDays} days</td>
              <td className="num">{inr(t.volumeKwh)}</td>
              <td className="num">{t.landedRate !== null ? t.landedRate.toFixed(4) : '—'}</td>
              <td className="num">{inr(t.iexCost, 2)}</td>
              <td className="num">{t.benchmarkRate !== null ? t.benchmarkRate.toFixed(4) : '—'}</td>
              <td className="num">{inr(t.gridCost, 2)}</td>
              <td className={'num' + (t.savings < 0 ? ' neg' : '')}>{inr(t.savings, 2)}</td>
              <td className="num">{t.percentBelow !== null ? `${(t.percentBelow * 100).toFixed(2)}%` : '—'}</td>
              <td className="ecv-sticky-end" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------- dispatch
export function SavingsWidgetView({ w, ctx }: { w: SavingsWidget; ctx: Ctx }) {
  switch (w.type) {
    case 'savings.folder': return <SavingsFolder {...ctx} title={w.title} />;
    case 'savings.tiles': return <SavingsTiles {...ctx} tiles={w.tiles} />;
    case 'savings.daily': return <SavingsDaily {...ctx} title={w.title} />;
    case 'savings.charges': return <SavingsCharges {...ctx} title={w.title} />;
    case 'savings.tod': return <SavingsTod {...ctx} title={w.title} />;
    case 'savings.profile': return <SavingsProfile {...ctx} days={w.days} title={w.title} />;
    case 'savings.table': return <SavingsTable {...ctx} title={w.title} />;
  }
}
