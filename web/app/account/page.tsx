import { requireUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { loadScope } from '@/lib/queries/scope';
import { syncLagMinutes } from '@/lib/queries/sync';
import { currentBlock } from '@/lib/time';
import { Shell } from '@/components/shell/Shell';
import { Card } from '@/components/ui/Card';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your account' };

export default async function AccountPage() {
  const user = await requireUser();
  const { scope, lag } = await withUser(user.id, async (q) => ({ scope: await loadScope(q), lag: await syncLagMinutes(q) }));
  const role = user.role === 'admin' ? 'Admin' : user.role === 'manager' ? 'Manager' : 'Client';
  return (
    <Shell user={user} page="account" liveBlock={currentBlock()} syncLag={lag} themeMode="dark">
      <div className="ecv-stack ecv-account">
        <Card title="Your details">
          <dl className="ecv-account__dl">
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Access</dt><dd>{role} · {scope.plants.length} plant{scope.plants.length === 1 ? '' : 's'}{scope.clients.length ? ` of ${scope.clients.map((c) => c.alias_name || c.name).join(', ')}` : ''}</dd>
          </dl>
        </Card>
        <Card title="Change password" sub="You stay signed in on this device.">
          <PasswordForm />
        </Card>
      </div>
    </Shell>
  );
}
