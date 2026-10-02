import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, IDS } from '../lib/game.mjs';
import { classifyHumanSpeech, decide, idleDueAt, nextAiAction } from '../lib/ai.mjs';

test('결과 확인 중 지목 응답과 침묵 재시도, 실패 및 정지 경계를 검사한다', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const phase of ['VOTE_RESULT', 'QUEST_RESULT']) {
      let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
      game.phase = phase;
      game.pendingDiscussion = null;
      assert.equal(nextAiAction(game), null);
      game = apply(game, 'human', { type: 'CHAT', text: '혹시 도윤님 왜 반대했는 지 들어볼 수 있을까요?', speechAct: 'OTHER' });
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        const prompt = JSON.parse(options.body).contents[0].parts[0].text;
        assert.ok(prompt.includes('"name":"도윤"'));
        assert.ok(!prompt.includes('사람이 당신을 이름으로 지목했습니다'));
        const action = calls === 1 ? { type: 'SILENCE' } : { type: 'CHAT', text: '팀 선정 근거를 더 듣고 싶어요.', speechAct: 'ANSWER' };
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(action) }] } }] }) };
      };
      const decision = await decide(game, nextAiAction(game), 'configured-key');
      assert.equal(decision.actor, 'ai2');
      assert.equal(calls, 2);
      game = apply(game, decision.actor, decision.action);
      assert.equal(game.phase, phase);
      assert.equal(game.messages.at(-1).replyTo, 'msg-1');
      assert.equal(nextAiAction(game), null);
      game = apply(game, 'human', { type: 'CHAT', text: '도윤님?', speechAct: 'OTHER' });
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"type":"SILENCE"}' }] } }] }) });
      await assert.rejects(decide(game, nextAiAction(game), 'configured-key'), error => error.code === 'DIRECT_REPLY_FAILED');
      game.paused = true;
      assert.equal(nextAiAction(game), null);
      game.paused = false;
      game.phase = 'ENDED';
      assert.equal(nextAiAction(game), null);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('Vertex 중계 서버에 인증 토큰과 기존 생성 요청을 전달한다', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, 'https://vertex.example.invalid/generate');
    assert.equal(options.headers['x-avalon-proxy-token'], 'test-token');
    assert.equal(options.headers['x-goog-api-key'], undefined);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"type":"VOTE","choice":"APPROVE"}' }] } }] }) };
  };
  try {
    const game = createGame(() => 0.5);
    const result = await decide(game, { actor: 'ai1', type: 'VOTE' }, { url: 'https://vertex.example.invalid/generate', token: 'test-token' });
    assert.equal(result.action.choice, 'APPROVE');
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('사람 발언은 공개 문맥으로만 Gemini가 분류하고 원문은 엔진에 그대로 저장한다', async () => {
  const game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const originalFetch = globalThis.fetch;
  let prompt;
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"speechAct":"QUESTION"}' }] } }],
      usageMetadata: { promptTokenCount: 21, candidatesTokenCount: 5 } }) };
  };
  try {
    const text = '도윤, 왜 그 팀을 골랐나요?';
    const classified = await classifyHumanSpeech(game, text, null, 'configured-key');
    assert.equal(classified.speechAct, 'QUESTION');
    assert.equal(classified.usage.input, 21);
    assert.ok(prompt.includes(JSON.stringify(text)));
    assert.ok(!prompt.includes('"role":'));
    assert.ok(!prompt.includes('"known":'));
    const next = apply(game, 'human', { type: 'CHAT', text, speechAct: classified.speechAct });
    assert.deepEqual([next.messages.at(-1).text, next.messages.at(-1).speechAct], [text, 'QUESTION']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('분류 태그가 잘못되면 오류로 처리하고 키가 없으면 OTHER를 반환한다', async () => {
  const game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  assert.equal((await classifyHumanSpeech(game, '안녕하세요', null, '')).speechAct, 'OTHER');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"speechAct":"UNKNOWN"}' }] } }] }) });
  try {
    await assert.rejects(classifyHumanSpeech(game, '안녕하세요', null, 'configured-key'), error => error.code === 'INVALID_TAG');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('모델 HTTP 실패는 원문 없이 분류 가능한 코드로 남긴다', async () => {
  const game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await assert.rejects(decide(game, { actor: 'ai1', type: 'VOTE' }, 'configured-key'),
      error => error.code === 'HTTP_503');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('잘못된 JSON은 한 번 재시도하고 계속 잘못되면 코드만 반환한다', async () => {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const opening = await decide(game, nextAiAction(game), 'configured-key');
  game = apply(game, opening.actor, opening.action);
  game = apply(game, 'human', { type: 'CHAT', text: '첫 팀 생각은?', speechAct: 'QUESTION' });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: calls === 1 ? 'oops' : '{"type":"CHAT","text":"첫 팀을 논의해요.","speechAct":"QUESTION"}' }] } }] }) };
  };
  try {
    const result = await decide(game, nextAiAction(game), 'configured-key');
    assert.equal(result.action.type, 'CHAT');
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'oops' }] } }] }) }; };
    await assert.rejects(decide(game, nextAiAction(game), 'configured-key'), error => error.code === 'INVALID_JSON');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('연습 모드는 한 번 말한 뒤 멈추고 사람 질문의 지목을 따른다', async () => {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const first = await decide(game, nextAiAction(game), '');
  game = apply(game, first.actor, first.action);
  assert.notEqual(nextAiAction(game)?.type, 'DISCUSS');
  game = apply(game, game.leader, { type: 'PROPOSE', team: IDS.slice(0, 2) });
  const second = await decide(game, nextAiAction(game), '');
  game = apply(game, second.actor, second.action);
  game = apply(game, 'human', { type: 'CHAT', text: '도윤은 어떻게 생각해?', speechAct: 'QUESTION' });
  assert.equal((await decide(game, nextAiAction(game), '')).actor, 'ai2');
});

test('새 게임 첫 발언은 현재 규칙만 말하고 다른 게임을 지어낸 모델 발언은 게시하지 않는다', async () => {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).contents[0].parts[0].text);
    const action = { type: 'CHAT', text: '저번 게임 투표에서 네 선택이 수상했어.', speechAct: 'CHALLENGE' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(action) }] } }] }) };
  };
  try {
    const opening = await decide(game, nextAiAction(game), 'configured-key');
    assert.equal(opening.action.type, 'CHAT');
    assert.match(opening.action.text, /첫 원정/);
    assert.equal(prompts.length, 0);
    game = apply(game, opening.actor, opening.action);
    game = apply(game, 'human', { type: 'CHAT', text: '다들 생각은?', speechAct: 'QUESTION' });
    const decision = await decide(game, nextAiAction(game), 'configured-key');
    assert.deepEqual(decision.action, { type: 'SILENCE' });
    assert.equal(apply(game, decision.actor, decision.action).messages.length, 2);
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('이번 판의 공개 정보만 근거로 쓰세요'));
    assert.ok(!prompts[0].includes('다른 판의 기록은 제공되지 않습니다'));
    assert.ok(prompts[0].includes('"quests":[]'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('새 사건마다 AI 한 명이 한 번 발언하고 다음 행동으로 넘어간다', async () => {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  const opening = await decide(game, nextAiAction(game), 'configured-key');
  game = apply(game, opening.actor, opening.action);
  game = apply(game, game.leader, { type: 'PROPOSE', team: IDS.slice(0, 2) });
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    prompts.push(prompt);
    const action = { type: 'CHAT', text: `새 의견 ${prompts.length}`, speechAct: 'OTHER' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(action) }] } }] }) };
  };
  try {
    const decision = await decide(game, nextAiAction(game), 'configured-key');
    assert.equal(decision.action.type, 'CHAT');
    game = apply(game, decision.actor, decision.action);
    assert.equal(game.messages.length, 2);
    assert.equal(game.messages.at(-1).speechAct, 'OTHER');
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes('발언 목적'));
    assert.notEqual(nextAiAction(game)?.type, 'DISCUSS');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('8초 침묵 호출은 한 단계에 두 번만 허용하고 단계가 바뀌면 초기화한다', () => {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  game.leader = 'human';
  game = apply(game, 'system', { type: 'SILENCE' });
  for (let i = 1; i <= 2; i++) {
    game.lastDiscussionAt = new Date(Date.now() - 9000).toISOString();
    const request = nextAiAction(game);
    assert.equal(request?.idleTrigger, true);
    game = apply(game, 'system', { type: 'SILENCE', idleTrigger: true });
    assert.equal(game.idleCount, i);
  }
  assert.equal(idleDueAt(game), null);
  assert.equal(nextAiAction(game), null);
  game = apply(game, 'human', { type: 'PROPOSE', team: IDS.slice(0, 2) });
  assert.equal(game.idleCount, 0);
});

test('악 AI 두 명의 카드를 각각 Gemini에 요청하고 모델 선택을 유지한다', async () => {
  const game = createGame(() => 0.5);
  game.team = ['ai1', 'ai2', 'ai3'];
  game.roles.ai1 = 'ASSASSIN';
  game.roles.ai2 = 'MINION';
  game.roles.ai3 = 'LOYAL';
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    prompts.push(prompt);
    const choice = prompt.includes('"name":"하린"') ? 'SUCCESS' : 'FAIL';
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'CARD', choice }) }] } }] }) };
  };
  try {
    const first = await decide(game, { actor: 'ai1', type: 'CARD' }, 'configured-key');
    const second = await decide(game, { actor: 'ai2', type: 'CARD' }, 'configured-key');
    assert.deepEqual([first.action.choice, second.action.choice], ['SUCCESS', 'FAIL']);
    assert.deepEqual([first.mode, second.mode], ['gemini', 'gemini']);
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every(prompt => prompt.includes('동료의 미공개 투표를 섣부르게 안다고 하지 마세요')));
    assert.ok(prompts.every(prompt => prompt.includes('"roleClues":')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
