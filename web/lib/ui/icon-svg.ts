import { ICONS } from './icons.generated';

/** Same markup as ErgOS.icon(name, size), for handing to client components as strings. */
export function iconSvg(name: string, size = 14): string {
  return `<svg class="eg-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.bolt}</svg>`;
}

export function iconMap(names: string[], size = 14): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, iconSvg(n, size)]));
}
