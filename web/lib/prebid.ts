// Tolerant parser for prebid_plan.prebid_plan_data. Returns 96 kW values (index 0 = Block 1),
// or null when the shape is not recognised. Accepted shapes:
//   [96 numbers]                                   MW per block
//   [{ block|block_no|blockNo|slot|time_block, mw|quantity_mw|bid_mw|planned_mw|quantity|kw|quantity_kw }]
//   { blocks|data|plan|schedule|values: <any of these> }
//   { "1": x, ..., "96": x }                        MW per block (or objects with a quantity key)

const MW_KEYS = ['mw', 'quantity_mw', 'bid_mw', 'planned_mw', 'quantity'] as const;
const KW_KEYS = ['kw', 'quantity_kw'] as const;
const BLOCK_KEYS = ['block', 'block_no', 'blockNo', 'slot'] as const;
const WRAPPER_KEYS = ['blocks', 'data', 'plan', 'schedule', 'values'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** kW from an entry object, or null. */
function quantityKw(o: Obj): number | null {
  for (const k of KW_KEYS) if (k in o) { const n = num(o[k]); if (n !== null) return n; }
  for (const k of MW_KEYS) if (k in o) { const n = num(o[k]); if (n !== null) return n * 1000; }
  return null;
}

/** "09:00-09:15" -> 37 */
function blockFromTime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins % 15 !== 0 || mins >= 1440) return null;
  return mins / 15 + 1;
}

function fromEntries(arr: Obj[]): number[] | null {
  // a 0 in a "slot" key means the source counts from zero
  const zeroBased = arr.some((o) => 'slot' in o && num(o.slot) === 0);
  const out = new Array<number>(96).fill(0);
  let hits = 0;
  for (const o of arr) {
    let block: number | null = null;
    for (const k of BLOCK_KEYS) {
      if (k in o) { const n = num(o[k]); if (n !== null) { block = k === 'slot' && zeroBased ? n + 1 : n; break; } }
    }
    if (block === null && 'time_block' in o) block = blockFromTime(o.time_block);
    const q = quantityKw(o);
    if (block === null || q === null || !Number.isInteger(block) || block < 1 || block > 96) continue;
    out[block - 1] += q;
    hits++;
  }
  return hits ? out : null;
}

export function parsePrebid(data: unknown, depth = 0): number[] | null {
  if (depth > 3 || data == null) return null;
  if (typeof data === 'string') {
    try { return parsePrebid(JSON.parse(data), depth + 1); } catch { return null; }
  }
  if (Array.isArray(data)) {
    if (data.length === 96 && data.every((v) => num(v) !== null)) return data.map((v) => (num(v) as number) * 1000);
    if (data.length && data.every(isObj)) return fromEntries(data as Obj[]);
    return null;
  }
  if (isObj(data)) {
    for (const k of WRAPPER_KEYS) if (k in data) { const r = parsePrebid(data[k], depth + 1); if (r) return r; }
    const keys = Object.keys(data);
    if (keys.length && keys.every((k) => /^\d{1,2}$/.test(k) && Number(k) >= 1 && Number(k) <= 96)) {
      const out = new Array<number>(96).fill(0);
      let hits = 0;
      for (const k of keys) {
        const v = data[k];
        const q = isObj(v) ? quantityKw(v) : num(v) === null ? null : (num(v) as number) * 1000;
        if (q === null) continue;
        out[Number(k) - 1] += q;
        hits++;
      }
      return hits ? out : null;
    }
  }
  return null;
}

/** Sums several 96-block curves (e.g. one per market type). */
export function sumCurves(curves: number[][]): number[] {
  const out = new Array<number>(96).fill(0);
  for (const c of curves) for (let i = 0; i < 96; i++) out[i] += c[i] || 0;
  return out;
}
