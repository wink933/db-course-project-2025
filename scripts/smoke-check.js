/*
  Smoke-check for MediArchive Pro
  - Starts a temporary server on a random free port
  - Calls key APIs
  - Shuts down cleanly

  Usage:
    node scripts/smoke-check.js
*/

const { startServer, stopServer } = require('../server');

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

async function main() {
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server?.address?.()?.port || server?.port || 4000;

  const base = `http://localhost:${port}`;
  const bootstrap = await fetchJson(`${base}/api/bootstrap`);
  if (!bootstrap || !bootstrap.user) throw new Error('bootstrap.user missing');

  const media = await fetchJson(`${base}/api/media?search=`);
  if (!Array.isArray(media)) throw new Error('media list is not an array');

  console.log('[smoke] ok', {
    port,
    folders: bootstrap.folders?.length ?? 0,
    devices: bootstrap.devices?.length ?? 0,
    tags: bootstrap.tags?.length ?? 0,
    media: media.length
  });

  stopServer();
}

main().catch((err) => {
  console.error('[smoke] failed:', err?.stack || err);
  try {
    stopServer();
  } catch {}
  process.exitCode = 1;
});
