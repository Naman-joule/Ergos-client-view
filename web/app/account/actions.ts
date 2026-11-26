'use server';
import bcrypt from 'bcryptjs';
import { currentUser } from '@/lib/auth';
import { withUser, withUserWrite } from '@/lib/db';
import { passwordProblem } from '@/lib/password';
import { isLocked, recordFailure, clearFailures } from '@/lib/throttle';

export interface PasswordState { error: string | null; done: boolean }

/** Change the signed-in user's password: checks the current one (rate-limited like sign-in) and the rules. */
export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const user = await currentUser();
  if (!user) return { error: 'Your session has ended. Sign in again.', done: false };
  const current = String(form.get('current') ?? '').slice(0, 200);
  const next = String(form.get('next') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  if (!current || !next) return { error: 'Fill in all three fields.', done: false };
  if (next !== confirm) return { error: 'The new passwords don’t match.', done: false };
  if (next === current) return { error: 'Choose a password different from the current one.', done: false };
  const problem = passwordProblem(next, user.email);
  if (problem) return { error: problem, done: false };
  try {
    if (await isLocked(user.email)) return { error: 'Too many attempts. Try again in 15 minutes.', done: false };
    const [own] = await withUser(user.id, (q) => q<{ email: string; password_hash: string }>('SELECT email, password_hash FROM app_own_auth()'));
    if (!own || !(await bcrypt.compare(current, own.password_hash))) {
      await recordFailure(user.email);
      return { error: 'The current password is wrong.', done: false };
    }
    const hash = await bcrypt.hash(next, 12);
    const [r] = await withUserWrite(user.id, (q) => q<{ ok: boolean }>('SELECT app_set_own_password($1) AS ok', [hash]));
    if (!r?.ok) return { error: 'Your password couldn’t be changed. Ask your Joulewise contact.', done: false };
    await clearFailures(user.email);
    return { error: null, done: true };
  } catch (e) {
    const msg = (e as Error).message;
    console.error('password change failed:', msg);
    return { error: /app_own_auth|app_set_own_password/.test(msg)
      ? 'Changing passwords isn’t switched on yet (database migration 012). Ask your Joulewise contact.'
      : 'Your password couldn’t be changed right now. Try again in a few minutes.', done: false };
  }
}
