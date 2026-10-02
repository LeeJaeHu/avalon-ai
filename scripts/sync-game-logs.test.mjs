import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncOnce } from './sync-game-logs.mjs';

test('반복 동기화는 중복을 만들지 않고 변경·늦은 오류를 갱신하며 실패 뒤 재수집한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avalon-sync-test-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const config = { url: 'http://localhost:9999', token: 'test-only' };
  let version = 1, failure = 0, downloads = 0, reject = false;
  const fake = async url => {
    if (reject) return { ok: false, status: 401 };
    const detail = url.searchParams.has('id');
    if (detail) downloads++;
    return { ok: true, json: async () => detail
      ? { format: 'avalon-game-log-v1', game: { id, version, phase: 'ENDED' }, aiFailures: Array(failure).fill({ error_code: 'TEST' }) }
      : { games: [{ id, version, updated_at: 'fixed', failure_id: failure }], next: null } };
  };
  try {
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal((await syncOnce(config, root, fake)).saved, 0);
    version = 2; failure = 1;
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal((await readdir(join(root, 'logs'))).length, 1);
    assert.equal(JSON.parse(await readFile(join(root, 'logs', `avalon-${id}.json`))).aiFailures.length, 1);
    reject = true;
    await assert.rejects(syncOnce(config, root, fake), /HTTP_401/);
    reject = false; failure = 2;
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal(downloads, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
