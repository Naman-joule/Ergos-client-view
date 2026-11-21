// Number formatting: Indian digit grouping, compact axes, energy and rates.
// Pure functions, no imports: also used by the node:test suite.

const MINUS = '−';

/** Indian grouping: inr(391192.06, 2) === "3,91,192.06". No currency sign. */
export function inr(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0 && Math.abs(n).toFixed(dp) !== (0).toFixed(dp);
  const [int, frac] = Math.abs(n).toFixed(dp).split('.');
  let last = int.slice(-3);
  const rest = int.slice(0, -3);
  if (rest) last = ',' + last;
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last;
  return (neg ? MINUS : '') + grouped + (frac ? '.' + frac : '');
}

/** Rupees with Indian grouping: rupees(391192.06, 2) === "₹3,91,192.06". */
export function rupees(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—';
  return (n < 0 ? MINUS : '') + '₹' + inr(Math.abs(n), dp);
}

/** Axis / compact labels: 950, 12.5k, 3.9 L, 1.2 Cr. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  const trim = (s: string) => s.replace(/\.?0+$/, '');
  if (a >= 1e7) return sign + trim((a / 1e7).toFixed(2)) + ' Cr';
  if (a >= 1e5) return sign + trim((a / 1e5).toFixed(2)) + ' L';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return sign + String(Math.round(a));
}

/** kWh -> "50.55" (MWh, 2 dp, Indian grouping). */
export function mwhValue(kwh: number, dp = 2): string {
  return inr(kwh / 1000, dp);
}

/** kWh -> "50.55 MWh". */
export function mwh(kwh: number, dp = 2): string {
  return mwhValue(kwh, dp) + ' MWh';
}

/** ₹/kWh -> "₹5.33 / kWh". */
export function rate(rsPerKwh: number, dp = 2): string {
  if (!Number.isFinite(rsPerKwh)) return '—';
  return rupees(rsPerKwh, dp) + ' / kWh';
}

/** 0.2619 -> "26.19%". */
export function pct(fraction: number, dp = 2): string {
  if (!Number.isFinite(fraction)) return '—';
  return inr(fraction * 100, dp) + '%';
}

/** kW with grouping: "3,789 kW". */
export function kw(v: number): string {
  return inr(Math.round(v)) + ' kW';
}

/** Splits a rupee amount for "₹3,91,192<small>.06</small>" display. */
export function rupeeParts(n: number): { whole: string; paise: string } {
  const s = rupees(n, 2);
  const i = s.lastIndexOf('.');
  return { whole: s.slice(0, i), paise: s.slice(i) };
}
