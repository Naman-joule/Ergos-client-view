import Link from 'next/link';

/** Market section: market-wide prices, and the plant's IEX obligation reports. */
export function MarketTabs({ current, reportsHref = '/market/reports' }: { current: 'prices' | 'reports'; reportsHref?: string }) {
  return (
    <nav className="ecv-tabs" aria-label="Market">
      <Link href="/market/prices" aria-current={current === 'prices' ? 'page' : undefined}>IEX prices</Link>
      <Link href={reportsHref} aria-current={current === 'reports' ? 'page' : undefined}>Obligation reports</Link>
    </nav>
  );
}
