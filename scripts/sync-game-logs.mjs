import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveGameLog } from './save-game-log.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function syncOnce(config, root = project, fetcher = fetch) {
  const origin = new URL(config.url);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('INVALID_ORIGIN');
  if (!config.token) throw new Error('MISSING_CREDENTIAL');
  const settings = join(resolve(root), '.log-sync');
  const directory = join(resolve(root), 'logs');
  await mkdir(settings, { recursive: true });
  let manifest = {};
  try { manifest = JSON.parse(await readFile(join(settings, 'manifest.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const get = async query => {
    const url = new URL('/api/logs', origin);
    url.search = query;
    const response = await fetcher(url, { headers: { 'x-avalon-log-token': config.token,
      ...(config.siteToken ? { 'OAI-Sites-Authorization': `Bearer ${config.siteToken}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  };
  let after = '';
  let saved = 0;
  let total = 0;
  const pages = new Set();
  do {
    if (pages.has(after)) throw new Error('REPEATED_PAGE');
    pages.add(after);
    const page = await get(after ? `after=${after}` : '');
    if (!Array.isArray(page.games)) throw new Error('INVALID_PAGE');
    for (const row of page.games) {
      if (!uuid.test(row.id) || !Number.isInteger(row.version)) throw new Error('INVALID_GAME');
      total++;
      const revision = `${row.version}:${row.updated_at}:${row.failure_id}`;
      const file = join(directory, `avalon-${row.id}.json`);
      let exists = false;
      try { await access(file); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (manifest[row.id] === revision && exists) continue;
      const log = await get(`id=${row.id}`);
      if (log.game?.id !== row.id || log.game?.phase !== 'ENDED') throw new Error('INVALID_LOG');
      if (!(await saveGameLog(directory, log)).saved) throw new Error('OLD_LOG');
      manifest[row.id] = revision;
      saved++;
    }
    after = page.next ?? '';
    if (after && !uuid.test(after)) throw new Error('INVALID_CURSOR');
  } while (after);
  // Persist revisions only after successful file writes; retries cannot skip unsaved records.
  const temporary = join(settings, 'manifest.json.tmp');
  await writeFile(temporary, JSON.stringify(manifest));
  await rename(temporary, join(settings, 'manifest.json'));
  return { total, saved };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(process.env.AVALON_LOG_SYNC_CONFIG ?? '{}');
  delete process.env.AVALON_LOG_SYNC_CONFIG;
  const once = process.argv.includes('--once');
  do {
    let status;
    try { status = { ok: true, ...(await syncOnce(config)), at: new Date().toISOString() }; }
    catch (error) { status = { ok: false, error: /^HTTP_\d+$|^[A-Z_]+$/.test(error.message) ? error.message : 'SYNC_ERROR', at: new Date().toISOString() }; }
    await mkdir(join(project, '.log-sync'), { recursive: true });
    await writeFile(join(project, '.log-sync/status.json'), JSON.stringify(status, null, 2));
    if (once) { console.log(JSON.stringify(status)); process.exitCode = status.ok ? 0 : 1; break; }
    await new Promise(resolve => setTimeout(resolve, status.ok ? 15000 : 60000));
  } while (true);
}
