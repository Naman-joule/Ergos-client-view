'use client';
import { useActionState } from 'react';
import { changePassword, type PasswordState } from './actions';

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, { error: null, done: false });
  if (state.done) return <p className="ecv-notice ecv-account__ok" role="status">Your password has been changed. Use the new one next time you sign in.</p>;
  return (
    <form action={action} className="ecv-login__form ecv-account__form">
      <label className="eg-field"><span className="eg-field__label">Current password</span>
        <span className="eg-input"><input name="current" type="password" autoComplete="current-password" required /></span></label>
      <label className="eg-field"><span className="eg-field__label">New password</span>
        <span className="eg-input"><input name="next" type="password" autoComplete="new-password" minLength={12} required aria-describedby="pw-hint" /></span></label>
      <label className="eg-field"><span className="eg-field__label">New password again</span>
        <span className="eg-input"><input name="confirm" type="password" autoComplete="new-password" minLength={12} required /></span></label>
      <p id="pw-hint" className="eg-muted ecv-account__hint">At least 12 characters. A few unrelated words with a number works well, e.g. “river-lamp-ochre-42”.</p>
      {state.error ? <p className="ecv-login__error" role="alert">{state.error}</p> : null}
      <button className="eg-btn eg-btn--primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}
