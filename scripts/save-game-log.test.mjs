import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveGameLog } from './save-game-log.mjs';

test('게임 코드별 한 파일을 갱신하고 늦게 도착한 과거 버전은 덮어쓰지 않는다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'avalon-log-test-'));
  const game = { id: '12345678-1234-1234-1234-123456789abc', version: 1 };
  const log = { format: 'avalon-game-log-v1', game, events: [] };
  try {
    await saveGameLog(directory, log);
    const newest = await saveGameLog(directory, { ...log, game: { ...game, version: 2 }, events: [{ type: 'ENDED' }] });
    assert.equal((await saveGameLog(directory, log)).saved, false);
    assert.equal(JSON.parse(await readFile(newest.file, 'utf8')).game.version, 2);
    assert.equal((await readdir(directory)).length, 1);
    await assert.rejects(saveGameLog(directory, { ...log, game: { id: '../outside', version: 1 } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
