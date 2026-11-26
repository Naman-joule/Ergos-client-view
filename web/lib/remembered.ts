import 'server-only';
import { cookies } from 'next/headers';

/** Cookie with the last client and plant viewed ('client:plant'), set by middleware.ts. */
export const SCOPE_COOKIE = 'ecv_scope';

/** The client and plant the user last looked at, so pages opened from the menu stay on it. */
export async function rememberedScope(): Promise<{ client?: string; plant?: string }> {
  const v = (await cookies()).get(SCOPE_COOKIE)?.value ?? '';
  const m = /^(\d+):(\d+)$/.exec(v);
  return m ? { client: m[1], plant: m[2] } : {};
}
