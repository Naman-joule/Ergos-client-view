/**
 * Turns client.logo_url from ergOS into a URL the browser may load, or null.
 * Accepts https URLs and inline data:image URLs; http is upgraded to https (an http image on an
 * https page is blocked anyway). A relative path like "/uploads/acme.png" is resolved against
 * ERGOS_ASSET_BASE_URL when that is set (e.g. https://ergos.joulewise.com), otherwise ignored.
 */
export function resolveLogoUrl(raw: string | null | undefined, base = process.env.ERGOS_ASSET_BASE_URL): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(v)) return v;
  try {
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      u.protocol = 'https:';
      return u.toString();
    }
    if (base && /^https:\/\//i.test(base)) return new URL(v.replace(/^\.?\/?/, '/'), base).toString();
  } catch {
    return null;
  }
  return null;
}
