/** Only same-site relative paths are accepted as a post-login destination. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/today';
  try {
    const u = new URL(next, 'http://ecv.local');
    if (u.origin !== 'http://ecv.local' || u.pathname.startsWith('/login') || u.pathname.startsWith('/logout')) return '/today';
    return u.pathname + u.search;
  } catch {
    return '/today';
  }
}
