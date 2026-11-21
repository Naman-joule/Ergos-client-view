// Types for the window.ErgOS runtime (subset of ergos-harmony/design-system/harmony.d.ts).
export type SeriesKey = 'solar' | 'wind' | 'hydro' | 'iex' | 'grid' | 'battery' | 'gov' | 'demand';
export type Palette = 'harmony' | 'volt' | 'verdant' | 'aurora';

export interface HoverRow { slot: number; block: number; time: string; demand: number; focus?: SeriesKey | null; [series: string]: unknown }
export interface AreaSeries { key: SeriesKey; label?: string; values: (number | null)[]; dashed?: boolean; fill?: boolean }
export interface AreaHoverRow { index: number; label: string; focus: SeriesKey | null; line: number | null; [key: string]: unknown }
export interface ChartApi { redraw(): void; setCursor?(i: number): void }

export interface ErgOSRuntime {
  icon(name: string, size?: number): string;
  supplyChart(host: HTMLElement, opts: {
    demand: number[]; layers: { key: SeriesKey; label?: string; values?: number[] }[]; now: number;
    height?: number; yMax?: number; palette?: Palette; label?: string; onHover?: (row: HoverRow) => void;
  }): ChartApi;
  trendChart(host: HTMLElement, opts: {
    series: AreaSeries[]; now?: number | null; cursor?: number; height?: number; unit?: string;
    format?: (v: number) => string; xLabel?: (i: number) => string; slots?: boolean; yAxis?: boolean;
    label?: string; onHover?: (row: AreaHoverRow) => void;
  }): ChartApi;
  savingsChart(host: HTMLElement, opts: { labels: string[]; savings: number[]; volume: number[]; height?: number }): ChartApi;
  heatmap(host: HTMLElement, opts: { rows: { label: string; values: number[] }[]; max?: number; series?: SeriesKey; rowHeight?: number }): ChartApi;
  ring(host: HTMLElement, opts: { parts: { key: SeriesKey; value: number }[]; size?: number; stroke?: number; label?: string }): void;
  sparkline(host: HTMLElement, values: number[], opts?: { series?: SeriesKey; height?: number; zero?: boolean; label?: string }): ChartApi;
}

declare global {
  interface Window { ErgOS?: ErgOSRuntime }
}

/** Resolves once harmony.js (loaded afterInteractive) has defined window.ErgOS. */
export function whenErgOS(): Promise<ErgOSRuntime> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return;
    const tick = () => (window.ErgOS ? resolve(window.ErgOS) : setTimeout(tick, 30));
    tick();
  });
}
