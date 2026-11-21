import { ICONS, type IconName } from '@/lib/ui/icons.generated';

/** Server-rendered line icon: the same SVG ErgOS.icon() returns, without DOM patching after hydration. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="eg-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? ICONS.bolt }}
    />
  );
}
export type { IconName };
