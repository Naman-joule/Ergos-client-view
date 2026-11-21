import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withUser } from './db';
import { SESSION_COOKIE, verifySession } from './session';
import type { Permission } from './dashboard/registry';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: string;
  permissions: Set<string>;
}

/**
 * The signed-in user, re-read from the database on every request (via app_session_user()),
 * so deactivating a user or changing their role takes effect immediately.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const id = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const rows = await withUser(id, (q) =>
    q<{ id: number; email: string; name: string; role: string; is_active: boolean; permissions: string[] }>(
      'SELECT id, email, name, role, is_active, permissions FROM app_session_user()',
    ),
  );
  const u = rows[0];
  if (!u || !u.is_active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, permissions: new Set(u.permissions) };
});

export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (permission && !u.permissions.has(permission)) redirect('/no-access');
  return u;
}
