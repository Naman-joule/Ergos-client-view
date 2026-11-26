'use client';
import { startTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Any page that fails on the server lands here instead of Next's bare "Application error" screen. The digest
 * is the id in the server log, so support can find the exact failure.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const router = useRouter();
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  // the failure was on the server: fetch the page again, then clear the error
  const retry = () => startTransition(() => { router.refresh(); reset(); });
  return (
    <main className="ecv-login">
      <section className="eg-glass ecv-login__card" role="alert">
        <span className="eg-wordmark">erg<i>OS</i></span>
        <h1 className="ecv-login__title">This page couldn’t load</h1>
        <p className="eg-muted">Something went wrong while fetching your data. It’s usually temporary: try again in a moment.</p>
        <div className="eg-row">
          <button className="eg-btn eg-btn--primary" type="button" onClick={retry}>Try again</button>
          <Link className="eg-btn eg-btn--ghost" href="/energy">Go to Energy</Link>
        </div>
        <p className="eg-muted ecv-error__ref">
          {support ? <>If it keeps happening, email <a href={`mailto:${support}?subject=${encodeURIComponent(`ergOS error ${error.digest ?? ''}`)}`}>{support}</a></> : 'If it keeps happening, tell your Joulewise contact'}
          {error.digest ? <> and quote reference <code>{error.digest}</code></> : null}.
        </p>
      </section>
    </main>
  );
}
