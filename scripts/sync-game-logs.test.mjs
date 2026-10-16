import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncOnce } from './sync-game-logs.mjs';

test('새 수집 폴더는 과거 판을 제외하고 중단/종료 판과 늦은 생각·비용을 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avalon-collection-test-'));
  const old = '12345678-1234-1234-1234-123456789abc', id = '22345678-1234-1234-1234-123456789abc';
  await mkdir(join(root, '.log-sync'));
  await writeFile(join(root, '.log-sync', 'collection.json'), JSON.stringify({directory:'playtests-2026-10-07',excludedGameIds:[old]}));
  const config = {url:'http://localhost:9999',token:'test-only'};
  let cost = null, thinking = null;
  const fake = async url => ({ok:true,json:async()=>url.searchParams.has('id')
    ? {format:'avalon-game-log-v1',game:{id,version:5,phase:'ENDED',endReason:'RESTARTED'},modelUsage:[{costUsd:cost,thinking}]}
    : {games:[old,id].map(id=>({id,version:5,updated_at:'fixed',failure_id:0})),next:null}});
  assert.equal((await syncOnce(config,root,fake)).saved,1);
  assert.deepEqual(await readdir(join(root,'logs')),['playtests-2026-10-07']);
  assert.deepEqual(await readdir(join(root,'logs','playtests-2026-10-07')),[`avalon-${id}.json`]);
  cost=.001;thinking='synthetic delayed self-report';
  assert.equal((await syncOnce(config,root,fake)).saved,1);
  const log=JSON.parse(await readFile(join(root,'logs','playtests-2026-10-07',`avalon-${id}.json`),'utf8'));
  assert.equal(log.modelUsage[0].thinking,thinking);assert.equal(log.modelUsage[0].costUsd,cost);
  assert.equal((await syncOnce(config,root,fake)).saved,0);
  await writeFile(join(root,'.log-sync','collection.json'),JSON.stringify({directory:'../escape',excludedGameIds:[]}));
  await assert.rejects(()=>syncOnce(config,root,fake),/INVALID_COLLECTION/);
});

test('반복 동기화는 중복을 만들지 않고 변경·늦은 오류를 갱신하며 실패 뒤 재수집한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avalon-sync-test-'));
  const id = '12345678-1234-1234-1234-123456789abc';
  const config = { url: 'http://localhost:9999', token: 'test-only' };
  let version = 1, failure = 0, downloads = 0, reject = false, usageRevision='pending',costUsd=null;
  const fake = async url => {
    if (reject) return { ok: false, status: 401 };
    const detail = url.searchParams.has('id');
    if (detail) downloads++;
    return { ok: true, json: async () => detail
      ? { format: 'avalon-game-log-v1', game: { id, version, phase: 'ENDED' },modelUsage:[{costUsd}], aiFailures: Array(failure).fill({ error_code: 'TEST' }) }
      : { games: [{ id, version, updated_at: 'fixed', failure_id: failure,usage_revision:usageRevision }], next: null } };
  };
  try {
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal((await syncOnce(config, root, fake)).saved, 0);
    usageRevision='complete';costUsd=.001;
    assert.equal((await syncOnce(config, root, fake)).saved,1);
    assert.equal(JSON.parse(await readFile(join(root,'logs',`avalon-${id}.json`))).modelUsage[0].costUsd,.001);
    assert.equal((await syncOnce(config,root,fake)).saved,0);
    version = 2; failure = 1;
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal((await readdir(join(root, 'logs'))).length, 1);
    assert.equal(JSON.parse(await readFile(join(root, 'logs', `avalon-${id}.json`))).aiFailures.length, 1);
    reject = true;
    await assert.rejects(syncOnce(config, root, fake), /HTTP_401/);
    reject = false; failure = 2;
    assert.equal((await syncOnce(config, root, fake)).saved, 1);
    assert.equal(downloads, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});
