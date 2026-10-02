import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEMPLATE, buildPromptV2 } from '../lib/prompts/v2.mjs';
import { buildPromptV1 } from '../lib/prompts/v1.mjs';
import { createGame, apply, observe, observeModerator, IDS } from '../lib/game.mjs';
import { decide, nextAiAction } from '../lib/ai.mjs';

test('V2 원문 보존·자리표시자 치환과 V1 보존을 확인한다', () => {
  assert.equal(TEMPLATE.replaceAll('\r\n', '\n'), readFileSync(new URL('../lib/prompts/v2.txt', import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
  const game = createGame(() => 0.5);
  const view = observe(game, 'ai2');
  const input = { game, view, request: { actor: 'ai2', type: 'CHAT', directReply: true }, publicState: observeModerator(game), personalInfo: { role: view.role, known: view.known } };
  const prompt = buildPromptV2(input);
  assert.ok(!prompt.includes('[역할]'));
  assert.ok(!prompt.includes('[공개 게임 상태 JSON]'));
  assert.ok(prompt.includes('"name":"도윤"'));
  assert.ok(!prompt.includes('사람이 당신을 이름으로 지목했습니다'));
  assert.ok(buildPromptV1(input).includes('사람이 당신을 이름으로 지목했습니다'));
});

test('V2 모의 모델로 세 판을 끝내고 thinking이 상태·화면·후속 입력에 남지 않는다', async () => {
  const originalFetch = globalThis.fetch;
  const seen = new Set();
  try {
    for (const seed of [0.2, 0.5, 0.8]) {
      let game = createGame(() => seed);
      game.aiConfig = { proposalPolicy: 'A' };
      game = apply(game, 'human', { type: 'START' });
      globalThis.fetch = async (_url, options) => {
        const prompt = JSON.parse(options.body).contents[0].parts[0].text;
        assert.ok(!prompt.includes('PRIVATE_THINKING_MARKER'));
        const request = JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
        seen.add(request.type);
        let action;
        if (request.type === 'PROPOSE') action = { type: 'PROPOSE', team: IDS.slice(0, request.requiredTeamSize) };
        if (request.type === 'VOTE') action = { type: 'VOTE', choice: 'APPROVE' };
        if (request.type === 'CARD') action = { type: 'CARD', choice: 'SUCCESS' };
        if (request.type === 'ASSASSINATE') action = { type: 'ASSASSINATE', target: IDS.find(id => id !== request.actor) };
        if (request.type === 'CHAT') action = { type: 'CHAT', text: '이번 팀의 구성을 살펴보겠습니다.', speechAct: 'ANSWER' };
        action.thinking = 'PRIVATE_THINKING_MARKER';
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(action) }] } }] }) };
      };
      game = apply(game, 'human', { type: 'CHAT', text: '도윤님 생각은요?', speechAct: 'OTHER' });
      for (let step = 0; step < 160 && game.phase !== 'ENDED'; step++) {
        const request = nextAiAction(game);
        if (request) {
          const decision = await decide(game, request, 'mock-only-key');
          assert.ok(!JSON.stringify(decision).includes('PRIVATE_THINKING_MARKER'));
          game = apply(game, decision.actor, decision.action);
        } else if (game.phase === 'PROPOSE') game = apply(game, 'human', { type: 'PROPOSE', team: IDS.slice(0, observe(game).size) });
        else if (game.phase === 'VOTE') game = apply(game, 'human', { type: 'VOTE', choice: 'APPROVE' });
        else if (['VOTE_RESULT', 'QUEST_RESULT'].includes(game.phase)) game = apply(game, 'human', { type: 'CONTINUE' });
        else if (game.phase === 'QUEST') game = apply(game, 'human', { type: 'CARD', choice: 'SUCCESS' });
        else if (game.phase === 'ASSASSINATE') game = apply(game, 'human', { type: 'ASSASSINATE', target: 'ai1' });
        else assert.fail(`진행 불가: ${game.phase}`);
        assert.ok(!JSON.stringify(game).includes('PRIVATE_THINKING_MARKER'));
        assert.ok(!JSON.stringify(observe(game)).includes('PRIVATE_THINKING_MARKER'));
      }
      assert.equal(game.phase, 'ENDED');
    }
    assert.deepEqual([...seen].sort(), ['ASSASSINATE', 'CARD', 'CHAT', 'PROPOSE', 'VOTE']);
  } finally { globalThis.fetch = originalFetch; }
});
