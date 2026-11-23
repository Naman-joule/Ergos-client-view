import type { DashboardSpec } from './schema.ts';

/** Built-in layout, used when neither the client nor the global config is published. */
export const DEFAULT_SPEC: DashboardSpec = {
  version: 1,
  theme: { palette: 'harmony', mode: 'dark' },
  pages: {
    today: {
      widgets: [
        { type: 'today.tiles', span: 'full', tiles: ['demand', 'grid', 'iex', 'solar', 'peak', 'iex_price'] },
        { type: 'today.supply', span: 'full' },
        { type: 'today.prebid', span: 'full' },
        { type: 'today.banking', span: 'full' },
      ],
    },
    savings: {
      widgets: [
        { type: 'savings.folder', span: 'wide' },
        { type: 'savings.tiles', span: 'narrow', tiles: ['volume', 'landed', 'benchmark'] },
        { type: 'savings.daily', span: 'full' },
        { type: 'savings.charges', span: 'full' },
        { type: 'savings.tod', span: 'full' },
        { type: 'savings.profile', span: 'full', days: 7 },
        { type: 'savings.table', span: 'full' },
      ],
    },
  },
};
