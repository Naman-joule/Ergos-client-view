import type { SessionUser } from './auth';

/** Joulewise staff (admins and managers) see data-quality notes about ergOS; clients see plain wording. */
export const isInternal = (u: Pick<SessionUser, 'role'>) => u.role === 'admin' || u.role === 'manager';
