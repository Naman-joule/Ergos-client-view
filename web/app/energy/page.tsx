import { one, type SP } from '@/lib/page-params';
import { DayView } from './DayView';
import { RangeView } from './RangeView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Energy' };

/** Energy hub: one day (live when it's today) or a range. A range is any of from / to / preset in the URL. */
export default async function EnergyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = Boolean(one(sp.from) || one(sp.to) || one(sp.preset));
  return range ? <RangeView sp={sp} /> : <DayView sp={sp} />;
}
