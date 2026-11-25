import Link from 'next/link';

export const metadata = { title: 'No access' };

export default function NoAccess() {
  return (
    <main className="ecv-login">
      <section className="eg-glass ecv-login__card">
        <span className="eg-wordmark">erg<i>OS</i></span>
        <h1 className="ecv-login__title">You don’t have access to this page</h1>
        <p className="eg-muted">Your account is signed in but has no permission for this view, or no plants are assigned to it yet. Ask your Joulewise contact to update your access.</p>
        <div className="eg-row">
          <Link className="eg-btn" href="/energy">Go to Energy</Link>
          <form method="post" action="/logout"><button className="eg-btn eg-btn--ghost" type="submit">Sign out</button></form>
        </div>
      </section>
    </main>
  );
}
