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
      <p className="ecv-login__help eg-muted">
        Forgot your password or locked out? {process.env.NEXT_PUBLIC_SUPPORT_EMAIL
          ? <>Email <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}?subject=ergOS%20password%20reset`}>{process.env.NEXT_PUBLIC_SUPPORT_EMAIL}</a> and we’ll reset it.</>
          : 'Ask your Joulewise account manager to reset it.'}
      </p>
      <p className="ecv-login__foot eg-muted">Joulewise · Energy management platform</p>
    </main>
  );
}
