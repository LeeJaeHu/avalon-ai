import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply } from '../lib/game.mjs';
import { decide, nextAiAction } from '../lib/ai.mjs';

const response = (action, finishReason = 'STOP') => ({ ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: typeof action === 'string' ? action : JSON.stringify(action) }] } }] }) });
function question(text) {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  game = apply(game, 'ai2', { type: 'CHAT', text: '원정을 진행해보고 판단하죠.', speechAct: 'OTHER' });
  return apply(game, 'human', { type: 'CHAT', text, speechAct: 'OTHER' });
}

test('이름 없는 2인칭 질문은 직전 도윤에게, 명시 이름은 해당 AI에게 전달한다', async () => {
  assert.equal((await decide(question('말하신건 찬성같은데, 반대하셨네요?'), nextAiAction(question('말하신건 찬성같은데, 반대하셨네요?')), '')).actor, 'ai2');
  const game = question('하린님은 왜 반대하셨나요?');
  assert.equal((await decide(game, nextAiAction(game), '')).actor, 'ai1');
});

test('실제 발언자·답변 대상 정보를 제공하고 다른 행동·자기 혼동을 재시도한다', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const invalid of [{ type: 'VOTE', choice: 'REJECT' }, { type: 'CHAT', text: '하린님 말도 일리가 있어요.', speechAct: 'ANSWER' }]) {
      let calls = 0;
      const game = question('하린은 의심되네요.');
      globalThis.fetch = async (_url, options) => {
        const input = JSON.parse(options.body);
        const prompt = input.contents[0].parts[0].text;
        assert.ok(prompt.includes('"id":"ai1","name":"하린"'));
        assert.ok(prompt.includes('"actor":"human"'));
        assert.deepEqual(input.generationConfig.responseSchema.properties.type.enum, ['CHAT', 'SILENCE']);
        return response(++calls === 1 ? invalid : { type: 'CHAT', text: '제 행동을 의심하시는 이유는 이해합니다.', speechAct: 'DEFENSE', thinking: 'HIDDEN' });
      };
      const result = await decide(game, nextAiAction(game), 'mock-only-key');
      assert.equal(calls, 2);
      assert.equal(result.actor, 'ai1');
      assert.equal(result.usage.retries, 1);
      assert.equal(result.action.thinking, undefined);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('계속 틀린 행동과 출력 잘림은 내용 없이 진단 정보를 남긴다', async () => {
  const originalFetch = globalThis.fetch;
  const game = question('도윤님은요?');
  try {
    globalThis.fetch = async () => response({ type: 'PROPOSE', team: ['human', 'ai1'] });
    await assert.rejects(decide(game, nextAiAction(game), 'mock-only-key'), error => error.code === 'UNEXPECTED_ACTION' && error.actor === 'ai2' && error.returnedType === 'PROPOSE' && error.expectedType === 'CHAT');
    globalThis.fetch = async () => response('{"thinking":"cut', 'MAX_TOKENS');
    await assert.rejects(decide(game, nextAiAction(game), 'mock-only-key'), error => error.code === 'OUTPUT_TRUNCATED' && error.finishReason === 'MAX_TOKENS' && error.responseChars > 0 && !error.message.includes('cut'));
  } finally { globalThis.fetch = originalFetch; }
});
