'use server';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { anonymous } from '@/lib/db';
import { SESSION_COOKIE, SESSION_HOURS, signSession } from '@/lib/session';
import { clearFailures, isLocked, recordFailure } from '@/lib/throttle';
import { safeNext } from '@/lib/safe-next';

// A real bcrypt hash (cost 12) of a random string. Compared against when the email is unknown,
// so the response time doesn't reveal which emails exist.
const DUMMY_HASH = '$2b$12$5aU1TIbATolmSrW2z78SIur5KA6QQA7S0p/zSCwCTjwrBaueG1Ulq';

export interface LoginState { error: string | null; email: string }

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 100);
  const password = String(form.get('password') ?? '').slice(0, 200);
  const next = safeNext(form.get('next'));
  const generic = { error: 'That email and password don’t match an active account.', email };

  if (!email || !password) return { error: 'Enter your email and password.', email };
  if (isLocked(email)) return { error: 'Too many attempts. Try again in 5 minutes.', email };

  try {
    const rows = await anonymous((q) =>
      q<{ id: number; password_hash: string; is_active: boolean }>('SELECT id, password_hash, is_active FROM app_auth_lookup($1)', [email]),
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      recordFailure(email);
      return generic;
    }
    clearFailures(email);

    (await cookies()).set(SESSION_COOKIE, await signSession(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    });
  } catch (e) {
    // Database unreachable or SESSION_SECRET missing: log the cause, show a calm message.
    console.error('login failed:', (e as Error).message);
    return { error: 'Sign-in is unavailable right now. Please try again in a few minutes.', email };
  }
  redirect(next);
}
