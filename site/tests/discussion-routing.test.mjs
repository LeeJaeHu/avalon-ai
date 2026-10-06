import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, SPEECH_ACTS } from '../lib/game.mjs';
import { baselineDiscussion, routeDiscussion, routingPayload, JEV_MODEL } from '../lib/discussion-routing.mjs';
import { decide, nextAiAction } from '../lib/ai.mjs';


function situation() {
  let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
  game = apply(game, 'ai2', { type: 'CHAT', text: '하린과 함께 가고 싶어요.', speechAct: 'TEAM_SUGGESTION' });
  return apply(game, 'human', { type: 'CHAT', text: '하린을 고른 이유는 뭐예요?', speechAct: 'QUESTION' });
}
export function jevResponse(choice = 'ai2') {
  const responder = ['ai1', 'ai2', 'ai3', 'ai4', 'WAIT'];
  return { model: JEV_MODEL, answers: {
    responder: { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(responder.map(id => [id, id === choice ? 1 : 0])) },
    speechAct: { type: 'choice', choice: 'QUESTION', confidence: 1, probabilities: Object.fromEntries(SPEECH_ACTS.map(id => [id, id === 'QUESTION' ? 1 : 0])) },
  }, usage: { input_tokens: 2000, output_tokens: 35 } };
}

test('baseline 보존, shadow 동일 상태 비교, jev 선택 적용과 키 없는 대체', async () => {
  const game = situation(), request = nextAiAction(game);
  const baseline = baselineDiscussion(game, request);
  assert.equal(baseline.actor, 'ai1');
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.headers.Authorization, 'Bearer mock-only');
    assert.ok(init.signal instanceof AbortSignal);
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, JEV_MODEL);
    assert.equal(payload.state.trigger.messageId, request.replyTo);
    return Response.json(jevResponse());
  };
  const original = JSON.stringify(game);
  const base = await routeDiscussion(game, request, { mode: 'baseline', key: 'mock-only', fetchImpl });
  assert.equal(base.actor, baseline.actor); assert.equal(calls, 0);
  const shadow = await routeDiscussion(game, request, { mode: 'shadow', key: 'mock-only', fetchImpl });
  const jev = await routeDiscussion(game, request, { mode: 'jev', key: 'mock-only', fetchImpl });
  assert.equal(calls, 2); assert.equal(shadow.actor, 'ai1'); assert.equal(jev.actor, 'ai2');
  assert.equal(shadow.record.jevChoice, 'ai2'); assert.equal(shadow.record.differs, true);
  assert.equal(shadow.record.inputHash, jev.record.inputHash);
  assert.equal(jev.record.inputTokens, 2000); assert.equal(jev.record.costUsd, 0.000084);
  assert.equal(JSON.stringify(game), original);
  assert.equal((await routeDiscussion(game, request, { mode: 'jev' })).record.status, 'NO_KEY');
});

test('명시 답장·비활성·빈 시작은 JEV 호출하지 않는다', async () => {
  let game = situation();
  game = apply(game, 'human', { type: 'CHAT', text: '하린은 빼는 게 어때요?', speechAct: 'QUESTION', replyTo: game.messages[0].id });
  const config = { mode: 'jev', key: 'mock-only', fetchImpl: () => assert.fail('JEV 호출 금지') };
  const reply = await routeDiscussion(game, nextAiAction(game), config);
  assert.equal(reply.actor, 'ai2'); assert.equal(reply.record.status, 'EXPLICIT_REPLY');
  for (const phase of ['ROLE_REVEAL', 'ENDED']) {
    assert.equal((await routeDiscussion({ ...game, phase }, { type: 'DISCUSS' }, config)).actor, 'WAIT');
  }
  assert.equal((await routeDiscussion({ ...game, paused: true }, { type: 'DISCUSS' }, config)).actor, 'WAIT');
  const start = apply(createGame(() => 0.5), 'human', { type: 'START' });
  assert.equal((await routeDiscussion(start, nextAiAction(start), config)).record.status, 'START');
});

test('공개 입력만 복사하며 비밀 배정과 악성 추가 필드가 입력을 바꾸지 않는다', () => {
  const game = situation(), request = nextAiAction(game);
  const original = routingPayload(game, request);
  const altered = structuredClone(game);
  altered.roles = { human: 'MERLIN', ai1: 'MINION', ai2: 'LOYAL', ai3: 'ASSASSIN', ai4: 'LOYAL' };
  altered.votes = { ai1: 'REJECT' }; altered.cards = { ai1: 'FAIL' };
  altered.privateCards = [{ secret: 'SECRET_CARD' }]; altered.evidence = 'SECRET_EVIDENCE';
  altered.messages.forEach(m => { m.thinking = 'SECRET_THINKING'; m.known = ['ai3']; });
  altered.proposals.push({ id: 'draft', status: 'VOTING', votes: [{ actor: 'ai1', choice: 'REJECT' }], privateCards: 'SECRET_CARD' });
  const result = routingPayload(altered, request);
  assert.deepEqual(result.state.messages, original.state.messages);
  assert.deepEqual({ ...result.state, proposals: [] }, { ...original.state, proposals: [] });
  assert.ok(!Object.hasOwn(result.state.proposals[0], 'votes'));
  assert.ok(!/SECRET_|"known"|"roles"|"role"|"cards"|"evidence"/.test(JSON.stringify(result)));
  assert.equal(Object.keys(routingPayload(game, request, true).questions.responder.criteria)[0], 'WAIT');
});

test('HTTP·잘못된 응답·시간 초과는 한 호출 후 기존 선택으로 대체하고 원문 오류를 버린다', async () => {
  const game = situation(), request = nextAiAction(game);
  const invalid = [
    () => ({ ok: false, status: 401 }), () => ({ ok: false, status: 429 }), () => ({ ok: false, status: 503 }),
    () => { throw Object.assign(new Error('SECRET_ERROR'), { name: 'TimeoutError' }); },
    () => { throw new Error('SECRET_NETWORK'); },
    () => ({ ok: true, json: async () => { throw new Error('SECRET_JSON'); } }),
    () => { const data = jevResponse(); data.answers.responder.choice = 'human'; return Response.json(data); },
    () => { const data = jevResponse(); data.answers.responder.probabilities.ai1 = 1; return Response.json(data); },
    () => { const data = jevResponse(); data.answers.responder.confidence = 2; return Response.json(data); },
    () => { const data = jevResponse(); data.usage.input_tokens = -1; return Response.json(data); },
  ];
  for (const response of invalid) {
    let calls = 0;
    const result = await routeDiscussion(game, request, { mode: 'jev', key: 'mock-only', fetchImpl: async () => { calls++; return response(); } });
    assert.equal(calls, 1); assert.equal(result.actor, 'ai1'); assert.equal(result.record.status, 'FALLBACK');
    assert.ok(!JSON.stringify(result).includes('SECRET_'));
  }
});

test('jev WAIT는 Gemini를 생략하고 shadow는 기존 생성 한 번을 유지한다', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(url);
      if (url.includes('typesafe')) return Response.json(jevResponse('WAIT'));
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      assert.ok(prompt.includes('"actor":"ai1"'));
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"type":"CHAT","text":"고른 이유를 답할게요.","speechAct":"ANSWER"}' }] } }] });
    };
    const game = situation(); game.aiConfig = { routingMode: 'jev' };
    const result = await decide(game, nextAiAction(game), 'mock-gemini', null, { key: 'mock-jev' });
    assert.equal(result.action.type, 'SILENCE'); assert.equal(result.mode, 'jev-wait'); assert.equal(calls.length, 1);
    assert.equal(apply(game, result.actor, result.action).pendingDiscussion, null);
    game.aiConfig.routingMode = 'shadow'; calls.length = 0;
    const shadow = await decide(game, nextAiAction(game), 'mock-gemini', null, { key: 'mock-jev' });
    assert.equal(shadow.actor, 'ai1'); assert.equal(calls.length, 2); assert.equal(shadow.routing.applied, false);
    calls.length = 0;
    await decide(game, nextAiAction(game), null, null, { key: 'mock-jev' });
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});
