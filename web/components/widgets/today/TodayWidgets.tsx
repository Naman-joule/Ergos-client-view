import type { TodayWidget } from '@/lib/dashboard/schema';
import type { TodayData } from '@/lib/queries/today';
import type { PlantRow } from '@/lib/queries/scope';
import { inr, mwhValue, rate as fmtRate } from '@/lib/format';
import { blockEnd, blockRange, blockStart, formatDateLong, formatWeekday } from '@/lib/time';
import { iconMap } from '@/lib/ui/icon-svg';
import { Folder, Sheet } from '../../ui/Folder';
import { Chip, LiveDot } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { Track } from '../../ui/Track';
import { Card } from '../../ui/Card';
import { Empty } from '../../ui/Empty';
import { StatTile } from '../../ui/StatTile';
import { Ring } from '../../charts/Ring';
import { SupplyChart } from '../../charts/SupplyChart';
import { TrendChart } from '../../charts/TrendChart';

interface Ctx { data: TodayData; plant: PlantRow }

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const pctText = (f: number) => `${Math.round(f * 100)}%`;

// ---------------------------------------------------------------------------- folder
function TodayFolder({ data, plant, title }: Ctx & { title?: string }) {
  const t = data.totals;
  const renewable = share(t.solarKwh, t.demandKwh);
  const done = data.now + 1;
  const left = 96 - done;
  return (
    <Folder sheets={<>
      <Sheet kicker="Renewable">Captive solar<b>{mwhValue(t.solarKwh)} MWh</b><div className="ecv-sheet-gap">Share</div><b>{pctText(renewable)}</b></Sheet>
      <Sheet kicker="Peak">Demand<b>{data.peak ? `${inr(Math.round(data.peak.kw))} kW` : '—'}</b><div className="ecv-sheet-gap">At</div>
        <b>{data.peak ? `${blockEnd(data.peak.block)} · Block ${data.peak.block}` : '—'}</b></Sheet>
      <Sheet kicker="IEX DAM">Bought<b>{mwhValue(t.iexKwh)} MWh</b><div className="ecv-sheet-gap">Landed rate</div>
        <b>{data.landedRate !== null ? fmtRate(data.landedRate) : '—'}</b></Sheet>
    </>}>
      <div className="eg-folder__head">
        <h2 className="eg-folder__title">{title ?? 'Today'}</h2>
        <p className="eg-folder__sub"><span className="ecv-nowrap">{plant.name}</span><br /><span className="ecv-nowrap">{formatDateLong(data.date)}</span></p>
      </div>
      {data.now < 0 ? (
        <div className="ecv-folder-empty"><b>No meter data for this day yet.</b><span>Readings arrive with the next sync, every 15 minutes.</span></div>
      ) : (
        <div className="ecv-today-hero">
          <div>
            <div className="eg-overline ecv-on-folder-muted">{data.isToday ? 'Total demand so far' : 'Total demand'}</div>
            <div className="ecv-big">{mwhValue(t.demandKwh)}<span>MWh</span></div>
            <div className="eg-row ecv-hero-chips">
              {data.isToday ? <Chip><LiveDot />Live · Block {done}</Chip> : <Chip>All 96 blocks</Chip>}
              {data.peak ? <Chip>Peak {inr(Math.round(data.peak.kw))} kW at {blockEnd(data.peak.block)}</Chip> : null}
              {data.hasSolar ? <Chip><Icon name="solar" size={13} />Renewable {pctText(renewable)}</Chip> : null}
            </div>
          </div>
          <div className="ecv-ring-row">
            <div className="eg-ringwrap">
              <Ring label="Supply mix so far" parts={[
                ...(data.hasSolar ? [{ key: 'solar' as const, value: t.solarKwh }] : []),
                { key: 'iex', value: t.iexKwh }, { key: 'grid', value: t.gridKwh },
              ]} />
              <div className="eg-ringwrap__center"><b>{pctText(share(t.iexKwh, t.demandKwh))}</b><span>from IEX</span></div>
            </div>
            <div className="ecv-mini-legend">
              <div><span className="eg-swatch" data-series="grid" />Grid (derived)<b>{mwhValue(t.gridKwh)}</b></div>
              <div><span className="eg-swatch" data-series="iex" />IEX<b>{mwhValue(t.iexKwh)}</b></div>
              {data.hasSolar ? <div><span className="eg-swatch" data-series="solar" />Solar<b>{mwhValue(t.solarKwh)}</b></div> : null}
              <div className="ecv-mini-legend__unit">MWh</div>
            </div>
          </div>
        </div>
      )}
      <Track value={done / 96} left="00:00 · Block 1" leftNote="Day started"
        right="24:00 · Block 96" rightNote={left > 0 ? `${left} block${left === 1 ? '' : 's'} to go` : 'Day complete'} />
    </Folder>
  );
}

// ---------------------------------------------------------------------------- tiles
function TodayTiles({ data, tiles }: Ctx & { tiles: readonly string[] }) {
  const t = data.totals;
  const day = formatWeekday(data.date).replace(',', '');
  const h = data.history;
  const spark = (f: (d: TodayData['history'][number]) => number | null) => {
    const v = h.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length >= 2 ? v : null;
  };
  const prev = h.length >= 2 ? h[h.length - 2] : null;
  const delta = prev?.landedRate != null && data.landedRate != null ? data.landedRate - prev.landedRate : null;

  const render = (k: string) => {
    switch (k) {
      case 'grid':
        return <StatTile key={k} series="grid" label="Grid" icon="grid" date={day} value={mwhValue(t.gridKwh)} unit="MWh"
          foot="Derived: demand not met by solar, banking or IEX" footChip={<Chip>{pctText(share(t.gridKwh, t.demandKwh))}</Chip>} />;
      case 'iex':
        return <StatTile key={k} series="iex" label="Power exchange" icon="exchange" date={day} value={mwhValue(t.iexKwh)} unit="MWh"
          spark={spark((d) => d.iexMwh)} foot={`${pctText(share(t.iexKwh, t.demandKwh))} of demand`}
          footChip={<Chip tone="accent">{pctText(share(t.iexKwh, t.demandKwh))}</Chip>} />;
      case 'solar':
        return <StatTile key={k} series="solar" label="Solar" icon="solar" date={day} value={mwhValue(t.solarKwh)} unit="MWh"
          foot={data.hasSolar ? (t.surplusKwh > 0.5 ? `${mwhValue(t.surplusKwh)} MWh beyond demand` : 'Captive, through mapping') : 'No solar mapped'} />;
      case 'peak':
        return <StatTile key={k} series="wind" label="Peak demand" icon="gauge" date={day}
          value={data.peak ? inr(Math.round(data.peak.kw)) : '—'} unit="kW" spark={spark((d) => d.peakKw)}
          foot={data.peak ? `at ${blockEnd(data.peak.block)} · Block ${data.peak.block}` : 'No readings'} />;
      case 'demand':
        return <StatTile key={k} series="demand" label="Demand" icon="bolt" date={day} value={mwhValue(t.demandKwh)} unit="MWh"
          spark={spark((d) => d.demandMwh)} foot={data.isToday ? 'So far today' : 'Whole day'} />;
      case 'iex_price':
        return <StatTile key={k} series="iex" label="IEX landed price" icon="rupee" date={day}
          value={data.landedRate !== null ? `₹${data.landedRate.toFixed(2)}` : '—'} unit="/ kWh"
          spark={spark((d) => d.landedRate)} foot="Landed, incl. open access charges"
          footChip={delta === null ? undefined : Math.abs(delta) < 0.005 ? <Chip>No change</Chip>
            : <Chip tone={delta > 0 ? 'negative' : 'accent'}>{delta > 0 ? '▲' : '▼'} ₹{Math.abs(delta).toFixed(2)}</Chip>} />;
      default:
        return null;
    }
  };
  return <div className={'ecv-tiles' + (tiles.length > 4 ? ' ecv-tiles--3' : '')}>{tiles.map(render)}</div>;
}

// ---------------------------------------------------------------------------- supply
function TodaySupply({ data, plant, title }: Ctx & { title?: string }) {
  return (
    <Card title={<>{title ?? 'Energy supply'} {data.isToday ? <Chip tone="accent"><LiveDot />Live</Chip> : null}</>}
      sub={`${plant.name} · ${formatDateLong(data.date)} · IEX settles first, then solar and banking · grid is derived · surplus solar above demand`}>
      {data.now < 0 ? <Empty title="No meter data for this day yet">The supply chart fills in as readings arrive.</Empty> : (
        <SupplyChart demand={data.demand} solarUsed={data.solarUsed} bank={data.bank} iex={data.iex} iexUsed={data.iexUsed} grid={data.grid}
          surplus={data.surplus} iexRate={data.iexRate} now={data.now} dayLabel={formatWeekday(data.date).replace(',', '')}
          tod={data.tod} gridRate={data.gridRate}
          icons={iconMap(['solar', 'exchange', 'grid', 'battery'], 13)} />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- prebid
function TodayPrebid({ data, plant, title }: Ctx & { title?: string }) {
  const head = title ?? 'Prebid plan against cleared';
  const sub = `${plant.name} · ${formatDateLong(data.date)}`;
  if (data.prebid.status === 'none' && !data.iex.some((v) => v > 0)) {
    return <Card title={head} sub={sub}><Empty title="No prebid plan or cleared trade for this day" icon="file" /></Card>;
  }
  const plan = data.prebid.planKw;
  const plannedKwh = plan ? plan.reduce((a, b) => a + b, 0) / 4 : null;
  const clearedKwh = data.iex.reduce((a, b) => a + b, 0) / 4;
  const blocks = data.iex.map((v, i) => (v > 0 ? i + 1 : 0)).filter(Boolean);
  const dev = plannedKwh ? (clearedKwh - plannedKwh) / plannedKwh : null;
  const series = [
    ...(plan ? [{ key: 'gov' as const, label: 'Plan', values: plan, dashed: true, fill: false }] : []),
    { key: 'iex' as const, label: 'Cleared', values: data.iex },
    { key: 'demand' as const, label: 'Demand', values: data.demand.map((v, i) => (i <= data.now ? v : null)), fill: false },
  ];
  return (
    <Card title={head} sub={sub} actions={<>
      {data.prebid.status === 'none' ? <Chip>No prebid plan</Chip> : null}
      {data.prebid.markets.length ? <Chip mono>{[...new Set(data.prebid.markets)].join(' + ')}</Chip> : null}
      {dev !== null ? <Chip tone={Math.abs(dev) > 0.1 ? 'warning' : 'accent'}>{Math.abs(dev) > 0.1 ? 'Deviation ' : 'On plan '}{dev >= 0 ? '+' : '−'}{Math.abs(dev * 100).toFixed(1)}%</Chip> : null}
    </>}>
      <div className="ecv-kv">
        <div><span>Planned</span><b>{plannedKwh !== null ? `${mwhValue(plannedKwh)} MWh` : '—'}</b></div>
        <div><span>Cleared</span><b>{mwhValue(clearedKwh)} MWh</b></div>
        <div><span>Cleared blocks</span><b>{blocks.length ? `${blockRange(blocks[0]!, blocks[blocks.length - 1]!)} · ${blockStart(blocks[0]!)}–${blockEnd(blocks[blocks.length - 1]!)}` : 'None'}</b></div>
      </div>
      {data.prebid.status === 'unrecognised'
        ? <Empty title="Plan format not recognised" icon="file">A prebid plan exists for this day, but its shape could not be read. Cleared volume is shown below.</Empty>
        : null}
      <TrendChart series={series} now={data.now >= 0 ? data.now : null} height={280} label={`Prebid plan, cleared IEX and demand on ${formatDateLong(data.date)}, kW per block`} />
    </Card>
  );
}

// ---------------------------------------------------------------------------- banking
function TodayBanking({ data, plant, title }: Ctx & { title?: string }) {
  const head = title ?? 'Banking';
  const sub = `${plant.name} · ${formatDateLong(data.date)}`;
  if (!data.banking.length) return <Card title={head} sub={sub}><Empty title="No banking for this plant on this day" icon="battery" /></Card>;
  const last = data.banking[data.banking.length - 1]!;
  const charged = data.banking.reduce((a, r) => a + r.charge, 0);
  const discharged = data.banking.reduce((a, r) => a + r.discharge, 0);
  const soc = new Array<number | null>(96).fill(null);
  for (const r of data.banking) if (r.block >= 1 && r.block <= 96) soc[r.block - 1] = r.soc;
  const f = (v: number | null) => (v === null ? '—' : inr(v, 0));
  return (
    <Card title={head} sub={`${sub} · balances at ${blockEnd(last.block)} · Block ${last.block}`}>
      <div className="ecv-kv">
        <div><span>Peak balance</span><b>{f(last.peak_balance)} kWh</b></div>
        <div><span>Normal balance</span><b>{f(last.normal_balance)} kWh</b></div>
        <div><span>Off-peak balance</span><b>{f(last.offpeak_balance)} kWh</b></div>
        <div><span>Charged</span><b>{inr(charged)} kWh</b></div>
        <div><span>Discharged</span><b>{inr(discharged)} kWh</b></div>
      </div>
      <TrendChart series={[{ key: 'battery', label: 'State of charge', values: soc }]} unit="kWh" height={220} now={last.block - 1}
        label={`Banked energy state of charge on ${formatDateLong(data.date)}, kWh per block`} />
    </Card>
  );
}

// ---------------------------------------------------------------------------- dispatch
export function TodayWidgetView({ w, ctx }: { w: TodayWidget; ctx: Ctx }) {
  switch (w.type) {
    case 'today.folder': return <TodayFolder {...ctx} title={w.title} />;
    case 'today.tiles': return <TodayTiles {...ctx} tiles={w.tiles} />;
    case 'today.supply': return <TodaySupply {...ctx} title={w.title} />;
    case 'today.prebid': return <TodayPrebid {...ctx} title={w.title} />;
    case 'today.banking': return <TodayBanking {...ctx} title={w.title} />;
  }
}
