'use client';
import { inr } from '@/lib/format';
import { LineChart } from './LineChart';

// Client wrappers for the IEX prices charts (functions can't be passed from a server component).
export interface MarketLine { key: string; label: string; slot: string; mcp: (number | null)[]; mcv: (number | null)[] }
export interface TrendPoint { date: string; avg: Record<string, number | undefined>; mwh: Record<string, number | undefined> }

const hhmm = (b: number) => `${String(Math.floor(b / 4)).padStart(2, '0')}:${String((b % 4) * 15).padStart(2, '0')}`;
const rs = (v: number) => `₹${v.toFixed(2)}`;
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (d: string) => `${Number(d.slice(8))} ${MO[Number(d.slice(5, 7)) - 1]}`;

export function IexDayChart({ markets, dayLabel }: { markets: MarketLine[]; dayLabel: string }) {
  return (
    <LineChart aria={`Market clearing price by 15-minute block, ${dayLabel}`} unit="₹/kWh" fmt={rs}
      series={markets.map((m) => ({ key: m.key, label: m.label, slot: m.slot, values: m.mcp }))}
      xLabel={(i) => `${hhmm(i)}–${hhmm(i + 1)}`} title={(i) => `${dayLabel} · Block ${i + 1} · ${hhmm(i)}–${hhmm(i + 1)}`}
      ticks={[0, 16, 32, 48, 64, 80, 95].map((i) => ({ i, label: i === 95 ? '24:00' : hhmm(i) }))}
      extra={(i) => markets.map((m) => ({ label: `${m.key} cleared`, value: m.mcv[i] != null ? `${inr(Math.round(m.mcv[i]!))} MW` : '—' }))} />
  );
}

export function IexTrendChart({ trend, markets }: { trend: TrendPoint[]; markets: { key: string; label: string; slot: string }[] }) {
  const every = Math.ceil(trend.length / 8);
  return (
    <LineChart aria="Daily volume-weighted clearing price, last 30 days" unit="₹/kWh" fmt={rs}
      series={markets.map((m) => ({ key: m.key, label: m.label, slot: m.slot, values: trend.map((d) => d.avg[m.key] ?? null) }))}
      xLabel={(i) => dm(trend[i]!.date)} title={(i) => `${dm(trend[i]!.date)} · volume-weighted average`}
      ticks={trend.map((d, i) => ({ i, label: dm(d.date) })).filter((_, i) => i % every === 0 || i === trend.length - 1)}
      extra={(i) => markets.map((m) => ({ label: `${m.key} cleared`, value: trend[i]!.mwh[m.key] != null ? `${inr(Math.round(trend[i]!.mwh[m.key]!))} MWh` : '—' }))} />
  );
}
