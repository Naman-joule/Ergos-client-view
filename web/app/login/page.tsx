import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { iconSvg } from '@/lib/ui/icon-svg';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await currentUser().catch(() => null)) redirect(next);
  return (
    <main className="ecv-login">
      <section className="eg-glass ecv-login__card">
        <span className="eg-wordmark">erg<i>OS</i></span>
        <h1 className="ecv-login__title">Sign in to your <em>energy</em> view</h1>
        <p className="eg-muted">Supply, IEX trades and savings for your plants, updated every 15 minutes.</p>
        <LoginForm next={next} mailSvg={iconSvg('user', 16)} lockSvg={iconSvg('shield', 16)} />
      </section>
      <p className="ecv-login__foot eg-muted">Joulewise · Energy management platform</p>
    </main>
  );
}
