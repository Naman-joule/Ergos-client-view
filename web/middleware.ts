import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/session';

export async function middleware(req: NextRequest) {
  const id = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) {
    const res = NextResponse.next();
    // remember the plant last viewed (?client=&plant=), so pages opened from the menu stay on it;
    // the pages still check access, this only picks a default
    const c = req.nextUrl.searchParams.get('client'), p = req.nextUrl.searchParams.get('plant');
    if (c && p && /^\d+$/.test(c) && /^\d+$/.test(p) && !req.nextUrl.pathname.startsWith('/api/')) {
      res.cookies.set('ecv_scope', `${c}:${p}`, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 86400 });
    }
    return res;
  }
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = '/login';
  url.search = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|api/health|_next/|vendor/|favicon\\.ico|favicon\\.svg).*)'],
};
