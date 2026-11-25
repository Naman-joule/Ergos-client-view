// FTP access for IEX obligation reports. Server only.
//
// Env (never NEXT_PUBLIC):
//   OBLIGATION_FTP_URL   ftps://user:pass@host:21/  (preferred) or ftp://…
//                        An account that can read and write ONLY the obligation folder; it is separate from
//                        REPORTS_FTP_URL, which stays read-only.
//   OBLIGATION_FTP_ROOT  folder the reports go under, default /iex_obligation
//   OBLIGATION_FTP_CA    optional PEM of the server's certificate/CA, for FTPS with a self-signed certificate
import 'server-only';
import { randomBytes } from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import path from 'node:path/posix';
import { Client } from 'basic-ftp';

export const obligationFtpConfigured = () => Boolean(process.env.OBLIGATION_FTP_URL);

function settings() {
  const url = process.env.OBLIGATION_FTP_URL;
  if (!url) throw new Error('OBLIGATION_FTP_URL is not set');
  const u = new URL(url);
  if (u.protocol !== 'ftp:' && u.protocol !== 'ftps:') throw new Error('OBLIGATION_FTP_URL must be ftp:// or ftps://');
  const secure = u.protocol === 'ftps:';
  const ca = process.env.OBLIGATION_FTP_CA?.replace(/\\n/g, '\n');
  return {
    host: u.hostname, port: Number(u.port) || 21,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    secure, secureOptions: secure ? { servername: u.hostname, ...(ca ? { ca } : {}) } : undefined,
  };
}

async function connect(): Promise<Client> {
  const client = new Client(20_000);
  try {
    await client.access(settings());
    return client;
  } catch (e) {
    client.close();
    throw e;
  }
}

/**
 * Write `data` to `target`: upload to a temporary name in the same folder, then rename over the target,
 * so a reader never sees a half-written PDF. Creates the folders as needed.
 */
export async function putObligationFile(target: string, data: Uint8Array): Promise<void> {
  const client = await connect();
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.upload-${randomBytes(6).toString('hex')}.part`);
  try {
    await client.ensureDir(dir);
    await client.uploadFrom(Readable.from(Buffer.from(data)), tmp);
    const size = await client.size(tmp);
    if (size !== data.byteLength) throw new Error(`uploaded ${size} of ${data.byteLength} bytes`);
    try { await client.remove(target); } catch { /* not there yet */ }
    await client.rename(tmp, target);
  } catch (e) {
    await client.remove(tmp).catch(() => {});
    throw e;
  } finally {
    client.close();
  }
}

/** Stream `file` from the server. Resolves once the transfer has started; the stream ends with the file. */
export async function getObligationFile(file: string): Promise<{ stream: ReadableStream; size: number | null }> {
  const client = await connect();
  let size: number | null = null;
  try { size = await client.size(file); } catch (e) { client.close(); throw e; }
  const body = new PassThrough();
  client.downloadTo(body, file)
    .then(() => body.end())
    .catch((e: Error) => { console.error('obligation: download failed:', e.message); body.destroy(e); })
    .finally(() => client.close());
  return { stream: Readable.toWeb(body) as ReadableStream, size };
}
