// Create or update an app user. Runs as the database owner (bypasses RLS), never from the app.
//
//   ADMIN_DATABASE_URL=postgresql://... npm run create-user -- someone@client.com "Full Name" \
//     --role client_user --clients 12 [--plants 34,35]
//   npm run create-user -- someone@client.com --deactivate
//   NEW_USER_PASSWORD=... npm run create-user -- someone@client.com --reset-password
//
// New users: password from NEW_USER_PASSWORD, or a generated one printed once.
// Existing users: the password only changes with NEW_USER_PASSWORD or --reset-password.
// --clients / --plants replace the user's mappings when given.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    role: { type: 'string' },
    clients: { type: 'string' },
    plants: { type: 'string' },
    deactivate: { type: 'boolean', default: false },
    activate: { type: 'boolean', default: false },
    'reset-password': { type: 'boolean', default: false },
  },
});

const [emailArg, nameArg] = positionals;
const fail = (m: string): never => { console.error(m); process.exit(1); };
if (!emailArg || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailArg)) fail('usage: create-user <email> [name] [--role r] [--clients 1,2] [--plants 3,4] [--deactivate]');
const email = emailArg!.trim().toLowerCase();
const ids = (s?: string) => (s ? s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0) : null);
const clients = ids(values.clients);
const plants = ids(values.plants);

const url = process.env.ADMIN_DATABASE_URL ?? fail('ADMIN_DATABASE_URL is not set (owner connection)');
const db = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false } });
await db.connect();

try {
  await db.query('BEGIN');
  const existing = (await db.query('SELECT id, name FROM "user" WHERE lower(email) = $1', [email])).rows[0] as { id: number; name: string } | undefined;

  let roleId: number | null = null;
  if (values.role) {
    const r = (await db.query('SELECT id FROM role WHERE name = $1', [values.role])).rows[0];
    if (!r) fail(`unknown role "${values.role}" (admin, manager, client_user)`);
    roleId = r.id;
  } else if (!existing) {
    fail('--role is required for a new user');
  }

  let password: string | null = null;
  let generated = false;
  if (!existing || values['reset-password'] || process.env.NEW_USER_PASSWORD) {
    password = process.env.NEW_USER_PASSWORD || null;
    if (!password) { password = randomBytes(18).toString('base64url'); generated = true; }
    if (password.length < 12) fail('NEW_USER_PASSWORD must be at least 12 characters');
  }
  const hash = password ? await bcrypt.hash(password, 12) : null;

  let userId: number;
  if (existing) {
    userId = existing.id;
    await db.query(
      `UPDATE "user" SET name = coalesce($2, name), role_id = coalesce($3, role_id),
              password_hash = coalesce($4, password_hash), last_reset = CASE WHEN $4::text IS NULL THEN last_reset ELSE now() END,
              is_active = CASE WHEN $5 THEN false WHEN $6 THEN true ELSE is_active END
       WHERE id = $1`,
      [userId, nameArg ?? null, roleId, hash, values.deactivate, values.activate],
    );
  } else {
    if (values.deactivate) fail('nothing to deactivate: no user with that email');
    userId = (await db.query(
      `INSERT INTO "user" (email, name, password_hash, role_id, is_active, last_reset) VALUES ($1, $2, $3, $4, true, now()) RETURNING id`,
      [email, nameArg ?? email.split('@')[0], hash, roleId],
    )).rows[0].id;
  }

  if (clients) {
    await db.query('DELETE FROM user_client_map WHERE user_id = $1', [userId]);
    for (const c of clients) await db.query('INSERT INTO user_client_map (user_id, client_id) VALUES ($1, $2)', [userId, c]);
  }
  if (plants) {
    await db.query('DELETE FROM user_plant_map WHERE user_id = $1', [userId]);
    for (const p of plants) await db.query('INSERT INTO user_plant_map (user_id, plant_id) VALUES ($1, $2)', [userId, p]);
  }
  await db.query('COMMIT');

  console.log(`${existing ? 'Updated' : 'Created'} user ${userId} <${email}>${values.deactivate ? ' (deactivated)' : ''}`);
  if (generated) console.log(`Password (shown once, share it securely): ${password}`);
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
