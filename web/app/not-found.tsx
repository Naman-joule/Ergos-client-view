import Link from 'next/link';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="ecv-login">
      <section className="eg-glass ecv-login__card">
        <span className="eg-wordmark">erg<i>OS</i></span>
        <h1 className="ecv-login__title">Page not found</h1>
        <p className="eg-muted">The link may be old or mistyped. Everything is reachable from the menu.</p>
        <div className="eg-row"><Link className="eg-btn eg-btn--primary" href="/energy">Go to Energy</Link></div>
      </section>
    </main>
  );
}
