'use client';
import { useRouter } from 'next/navigation';

/** Shown only when the user has more than one client. */
export function ClientSelect({ clients, current, path, keep }: {
  clients: { client_id: number; name: string }[]; current: number; path: string; keep: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <form method="get" action={path} className="ecv-client-select">
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="eg-field">
        <span className="eg-field__label">Client</span>
        <span className="eg-input">
          <select name="client" defaultValue={String(current)} aria-label="Client"
            onChange={(e) => {
              const qs = new URLSearchParams({ ...keep, client: e.target.value });
              router.push(`${path}?${qs}`);
            }}>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
          </select>
        </span>
      </label>
      <noscript><button className="eg-btn eg-btn--sm" type="submit">Show</button></noscript>
    </form>
  );
}
