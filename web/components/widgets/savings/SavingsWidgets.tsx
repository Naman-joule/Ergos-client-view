import type { SavingsWidget } from '@/lib/dashboard/schema';
import { CHARGE_COLUMNS, safeReportUrl, type Period, type SavingsData } from '@/lib/queries/savings';
import type { PlantRow } from '@/lib/queries/scope';
import { compact, inr, pct, rate as fmtRate, rupeeParts, rupees } from '@/lib/format';
import { formatDate, formatDayMonth, formatRange } from '@/lib/time';
import type { SeriesKey } from '@/lib/ui/ergos';
import { Folder, Sheet } from '../../ui/Folder';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { Track } from '../../ui/Track';
import { Card } from '../../ui/Card';
import { Empty } from '../../ui/Empty';
import { StatTile } from '../../ui/StatTile';
import { SourceBar } from '../../ui/SourceBar';
import { SavingsChart } from '../../charts/SavingsChart';
import { Heatmap } from '../../charts/Heatmap';

interface Ctx { data: SavingsData; plant: PlantRow; period: Period }

const rate4 = (v: number | null) => (v === null ? '—' : `₹${v.toFixed(4)} / kWh`);

function NoRows({ title, ctx }: { title: string; ctx: Ctx }) {
  return (
    <Card title={title} sub={`${ctx.plant.name} · ${formatRange(ctx.period.from, ctx.period.to)}`}>
      <Empty title="No savings statements in this period" icon="receipt">Daily statements appear here once ergOS locks them, usually the day after trading.</Empty>
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
        right={`Benchmark ${t.benchmarkRate !== null ? fmtRate(t.benchmarkRate) : '—'}`} rightNote="What the grid would have cost" />
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
        value={t.benchmarkRate !== null ? `₹${t.benchmarkRate.toFixed(4)}` : '—'} unit="/ kWh" foot="ToD weighted baseline" />;
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
      <SavingsChart labels={labels} savings={savings} volume={volume} height={320} />
    </Card>
  );
}

// ---------------------------------------------------------------------------- charges
const CHARGE_SERIES: SeriesKey[] = ['grid', 'solar', 'wind', 'hydro', 'battery', 'gov', 'demand', 'wind', 'hydro'];

function SavingsCharges({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Where the landed cost goes';
  if (!data.rows.length) return <NoRows title={head} ctx={{ data, plant, period }} />;
  const t = data.totals;
  const whole = t.iexCost || 1;
  return (
    <Card title={head} sub={`Share of ${rupees(t.iexCost)} landed cost · ${formatRange(period.from, period.to)}`}>
      <div className="ecv-sources">
        <SourceBar series="iex" icon="exchange" name="Exchange energy" share={t.energyCharge / whole} value={`₹${compact(t.energyCharge)}`} unit="" />
        {CHARGE_COLUMNS.map(([k, label], i) => (
          <SourceBar key={k} series={CHARGE_SERIES[i]!} icon="receipt" name={label} share={t.charges[k] / whole}
            value={`₹${compact(t.charges[k])}`} unit="" />
        ))}
      </div>
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

// ---------------------------------------------------------------------------- table
function SavingsTable({ data, plant, period, title }: Ctx & { title?: string }) {
  const head = title ?? 'Daily statement';
  if (!data.rows.length) return <NoRows title={head} ctx={{ data, plant, period }} />;
  const t = data.totals;
  const provisional = data.rows.filter((r) => !r.is_locked).length;
  return (
    <Card title={head} sub={`${plant.name} · ${formatRange(period.from, period.to)} · locked figures from ergOS are official`}
      actions={t.allLocked ? <Chip tone="accent"><Icon name="check" size={13} />Locked</Chip> : <Chip tone="warning">Provisional · {provisional} day{provisional === 1 ? '' : 's'}</Chip>}>
      <div className="ecv-table-wrap">
        <table className="ecv-table">
          <thead>
            <tr>
              <th>Date</th><th className="num">Volume (kWh)</th><th className="num">IEX landed (₹/kWh)</th><th className="num">IEX cost (₹)</th>
              <th className="num">Benchmark (₹/kWh)</th><th className="num">Grid cost (₹)</th><th className="num">Net savings (₹)</th>
              <th className="num">Below grid</th><th>Status</th><th>Report</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const url = safeReportUrl(r.pdf_report_path) ?? safeReportUrl(r.zip_bundle_path) ?? safeReportUrl(r.excel_file_path) ?? safeReportUrl(r.statement_docx_path);
              return (
                <tr key={r.trade_date}>
                  <td className="nowrap">{formatDate(r.trade_date)}</td>
                  <td className="num">{inr(r.volume_cleared_kwh)}</td>
                  <td className="num">{r.avg_landed_iex_tariff !== null ? r.avg_landed_iex_tariff.toFixed(4) : '—'}</td>
                  <td className="num">{inr(r.iex_total_cost, 2)}</td>
                  <td className="num">{r.avg_grid_tariff !== null ? r.avg_grid_tariff.toFixed(4) : '—'}</td>
                  <td className="num">{inr(r.grid_total_cost, 2)}</td>
                  <td className={'num' + (r.net_savings_per_day < 0 ? ' neg' : '')}>{inr(r.net_savings_per_day, 2)}</td>
                  <td className="num">{r.percent_below_grid !== null ? `${r.percent_below_grid.toFixed(2)}%` : '—'}</td>
                  <td>{r.is_locked ? <Chip>Locked</Chip> : <Chip tone="warning">Provisional</Chip>}</td>
                  <td>{url ? <a className="ecv-link" href={url} target="_blank" rel="noopener noreferrer">PDF<Icon name="download" size={13} /></a> : <span className="eg-muted">—</span>}</td>
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
              <td colSpan={2} />
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
