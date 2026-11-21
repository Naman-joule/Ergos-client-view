'use client';
import { useActionState } from 'react';
import { login, type LoginState } from './actions';

export function LoginForm({ next, mailSvg, lockSvg }: { next: string; mailSvg: string; lockSvg: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null, email: '' });
  return (
    <form action={action} className="ecv-login__form">
      <input type="hidden" name="next" value={next} />
      <label className="eg-field">
        <span className="eg-field__label">Email</span>
        <span className="eg-input">
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: mailSvg }} />
          <input name="email" type="email" autoComplete="username" required defaultValue={state.email} />
        </span>
      </label>
      <label className="eg-field">
        <span className="eg-field__label">Password</span>
        <span className="eg-input">
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: lockSvg }} />
          <input name="password" type="password" autoComplete="current-password" required />
        </span>
      </label>
      {state.error ? <p className="ecv-login__error" role="alert">{state.error}</p> : null}
      <button className="eg-btn eg-btn--primary eg-btn--lg eg-btn--block" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
