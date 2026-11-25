// How a plant's demand is met in each 15-minute block, shared by Today and History so both show the
// same numbers. Pure: no imports, used by the node:test suite.
//
// Bottom-up: the IEX purchase settles first (it is scheduled and paid for), then solar, then banked
// energy; the grid covers the rest. Solar beyond what demand still needed after IEX is surplus.
// Inputs and outputs are kW per block; blocks after `upTo` are left at 0.

export interface Allocation { iexUsed: number[]; solarUsed: number[]; bank: number[]; grid: number[]; surplus: number[] }

export function allocate(demand: number[], iex: number[], solar: number[], bankRaw: number[], upTo: number): Allocation {
  const n = demand.length;
  const z = () => new Array<number>(n).fill(0);
  const out: Allocation = { iexUsed: z(), solarUsed: z(), bank: z(), grid: z(), surplus: z() };
  for (let i = 0; i <= Math.min(upTo, n - 1); i++) {
    let room = Math.max(0, demand[i] || 0);
    out.iexUsed[i] = Math.min(iex[i] || 0, room); room -= out.iexUsed[i]!;
    out.solarUsed[i] = Math.min(solar[i] || 0, room); room -= out.solarUsed[i]!;
    out.bank[i] = Math.min(bankRaw[i] || 0, room); room -= out.bank[i]!;
    out.grid[i] = room;
    out.surplus[i] = Math.max(0, (solar[i] || 0) - out.solarUsed[i]!);
  }
  return out;
}

/** The stacked layers of the Energy supply charts, bottom-up, with their design-system colour slots. */
export const SUPPLY_LAYERS = [
  { key: 'iex', slot: 'iex', label: 'Power exchange' },
  { key: 'solar', slot: 'solar', label: 'Solar' },
  { key: 'bank', slot: 'battery', label: 'Banking' },
  { key: 'grid', slot: 'grid', label: 'Grid' },
  { key: 'surplus', slot: 'hydro', label: 'Surplus solar', hatch: true },
] as const;
export type SupplyKey = (typeof SUPPLY_LAYERS)[number]['key'];
