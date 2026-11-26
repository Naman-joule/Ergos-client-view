const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A month picker that works in every browser: a plain <select> of months, newest first, value 'YYYY-MM'.
 * <input type="month"> shows a bare text box in Safari and Firefox on laptops, where a typo gave a 400.
 */
export function MonthSelect({ name, value, max, months = 36, label }: {
  name: string; value: string; max: string; months?: number; label: string;
}) {
  const [y, m] = max.split('-').map(Number) as [number, number];
  const opts: string[] = [];
  for (let k = 0; k < months; k++) opts.push(new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7));
  if (!opts.includes(value)) opts.push(value);
  return (
    <select className="ecv-monthsel" name={name} defaultValue={value} aria-label={label}>
      {opts.map((o) => <option key={o} value={o}>{MON[Number(o.slice(5, 7)) - 1]} {o.slice(0, 4)}</option>)}
    </select>
  );
}
