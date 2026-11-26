// Password rules for a new password. Pure, so node:test can cover it.
const COMMON = ['password', 'admin', 'welcome', 'qwerty', 'letmein', 'joulewise', 'ergos', 'haldiram', '123456', 'abc123'];

/** null when acceptable, else the reason to show. */
export function passwordProblem(pw: string, email: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  const lower = pw.toLowerCase();
  const local = email.toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'Don’t include your email name in the password.';
  if (/^(.)\1+$/.test(pw)) return 'Don’t repeat one character.';
  const core = lower.replace(/[^a-z]/g, '');
  if (COMMON.some((w) => core === w || (core.startsWith(w) && core.length <= w.length + 2))) return 'That password is too easy to guess.';
  return null;
}
