import test from 'node:test';
import assert from 'node:assert/strict';
import { validLogToken } from '../lib/game-log.mjs';

test('로그 동기화는 설정된 전용 인증만 허용한다', async () => {
  assert.equal(await validLogToken(null, 'test-secret'), false);
  assert.equal(await validLogToken('test-secret', undefined), false);
  assert.equal(await validLogToken('wrong', 'test-secret'), false);
  assert.equal(await validLogToken('test-secret', 'test-secret'), true);
});
