import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createPrototype } from './server.mjs';
import { decide } from '../site/lib/ai.mjs';
import { createGame, apply, IDS } from '../site/lib/game.mjs';
import { buildHumanlikeTurn, PROMPT_VERSION } from '../site/lib/prompts/humanlike-v3.mjs';
import { humanlikeCases } from '../site/tests/humanlike-v3-cases.mjs';
import { JEV_MODEL } from '../site/lib/discussion-routing.mjs';
import { SPEECH_ACTS } from '../site/lib/game.mjs';

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'avalon-v3-'));
  const paths = { dataDir: join(directory, 'state'), logDir: join(directory, 'logs') };
  const server = createPrototype({ ...paths, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let game;
  async function post(type, extra = {}, expected = 200) {
    const response = await fetch(base + '/api/game', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, version: game?.version, ...extra }) });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    if (data.game) game = data.game;
    return data;
  }
  return { base, server, paths, post, get game() { return game; } };
}

test('V3가 모든 행동의 실제 Gemini 전송 경로에 연결되고 thinking/evidence는 분리된다', async () => {
  const originalFetch = globalThis.fetch;
  const seen = new Set();
  try {
    globalThis.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      const prompt = payload.contents[0].parts[0].text;
      assert.ok(prompt.includes('진행자나 해설자가 아니라'));
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(prompt));
      const schema = payload.generationConfig.responseSchema;
      const type = schema.properties.type.enum[0]; seen.add(type);
      const action = { type, thinking: 'PRIVATE_THINKING', evidence: { summary: '모의 선택 설명', references: ['self-role'], confidence: 'LOW' } };
      if (type === 'CHAT') Object.assign(action, { text: '도윤 대신 제가 들어가고 싶어요.', speechAct: 'TEAM_SUGGESTION' });
      if (type === 'PROPOSE') action.team = IDS.slice(0, schema.properties.team.minItems);
      if (type === 'VOTE') action.choice = 'APPROVE';
      if (type === 'CARD') action.choice = 'SUCCESS';
      if (type === 'ASSASSINATE') action.target = schema.properties.target.enum[0];
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(action) }] } }] }));
    };
    for (const scenario of humanlikeCases()) {
      const result = await decide(scenario.game, scenario.request, 'mock-only', buildHumanlikeTurn);
      assert.equal(result.mode, 'gemini');
      assert.equal(result.evidence.status, 'RECORDED');
      assert.ok(!JSON.stringify(result).includes('PRIVATE_THINKING'));
      assert.ok(!Object.hasOwn(result.action, 'evidence'));
    }
    let vote = createGame(() => 0.5); vote.leader = 'human';
    vote = apply(vote, 'human', { type: 'START' });
    vote = apply(vote, 'human', { type: 'PROPOSE', team: ['human', 'ai1'] });
    vote = apply(vote, 'human', { type: 'START_VOTE' });
    await decide(vote, { actor: 'ai2', type: 'VOTE' }, 'mock-only', buildHumanlikeTurn);
    assert.deepEqual([...seen].sort(), ['ASSASSINATE', 'CARD', 'CHAT', 'PROPOSE', 'VOTE']);
  } finally { globalThis.fetch = originalFetch; }
});

test('명시 답장 대상이 제삼자 이름보다 우선하고 V3 시작 발언은 모델을 사용한다', async () => {
  const originalFetch = globalThis.fetch;
  const actors = [];
  try {
    globalThis.fetch = async (_url, options) => {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      const request = JSON.parse(prompt.split('[요청 JSON]\n')[1].split('\n\n[출력 계약]')[0]); actors.push(request.actor);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'CHAT', text: '그 사람을 고른 이유부터 듣고 싶어요.', speechAct: 'ANSWER' }) }] } }] }));
    };
    let game = apply(createGame(() => 0.5), 'human', { type: 'START' });
    assert.equal((await decide(game, { type: 'DISCUSS', topic: 'start' }, 'mock-only', buildHumanlikeTurn)).mode, 'gemini');
    game = apply(game, 'ai2', { type: 'CHAT', text: '이 팀이 좋겠어요.', speechAct: 'OTHER' });
    const replyTo = game.messages.at(-1).id;
    game = apply(game, 'human', { type: 'CHAT', text: '하린을 고른 이유가 뭐예요?', replyTo, speechAct: 'QUESTION' });
    const result = await decide(game, { type: 'DISCUSS', replyTo: game.messages.at(-1).id }, 'mock-only', buildHumanlikeTurn);
    assert.equal(result.actor, 'ai2'); assert.equal(actors.at(-1), 'ai2');
    game = apply(game, 'human', { type: 'CHAT', text: '도윤, 하린 대신 서아는 어때요?', speechAct: 'QUESTION' });
    assert.equal((await decide(game, { type: 'DISCUSS', replyTo: game.messages.at(-1).id }, 'mock-only', buildHumanlikeTurn)).actor, 'ai2');
  } finally { globalThis.fetch = originalFetch; }
});

test('로컬 API로 완주하고 비밀 경계·로그·재시작 복구·새 판 보존을 확인한다', async t => {
  const app = await setup(t);
  assert.equal((await fetch(app.base)).status, 200);
  await app.post('NEW');
  assert.equal((await fetch(app.base + '/api/game?export=1')).status, 409);
  assert.ok(!app.game.roles && !app.game.privateCards && !app.game.aiConfig);
  await app.post('START');
  await app.post('CHAT', { text: '도윤, 함께 갈 팀을 말해 주세요.' });
  for (let i = 0; i < 170 && app.game.phase !== 'ENDED'; i++) {
    const game = app.game;
    if (game.aiPending) await app.post('ADVANCE');
    else if (game.phase === 'PROPOSE') await app.post('PROPOSE', { team: game.ids.slice(0, game.size) });
    else if (game.phase === 'TEAM_DISCUSSION') await app.post('START_VOTE');
    else if (game.phase === 'VOTE') await app.post('VOTE', { choice: 'APPROVE' });
    else if (['VOTE_RESULT', 'QUEST_RESULT'].includes(game.phase)) await app.post('CONTINUE');
    else if (game.phase === 'QUEST') await app.post('CARD', { choice: 'SUCCESS' });
    else if (game.phase === 'ASSASSINATE') await app.post('ASSASSINATE', { target: game.ids.find(id => id !== 'human') });
    else assert.fail(game.phase);
    if (app.game.phase !== 'ENDED') assert.ok(!app.game.roles && !app.game.privateCards);
  }
  assert.equal(app.game.phase, 'ENDED');
  const saved = await (await fetch(app.base + '/api/game?export=1')).json();
  assert.equal(saved.game.aiConfig.promptVersion, PROMPT_VERSION);
  assert.equal(saved.events.length, app.game.version + 1);
  assert.deepEqual(JSON.parse(readFileSync(join(app.paths.logDir, `avalon-${app.game.id}.json`), 'utf8')).game, saved.game);
  const restarted = createPrototype(app.paths);
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  const restored = await (await fetch(`http://127.0.0.1:${restarted.address().port}/api/game`)).json();
  assert.equal(restored.game.id, app.game.id); assert.equal(restored.game.version, app.game.version);
  await new Promise(resolve => restarted.close(resolve));
  await app.post('NEW'); await app.post('START'); await app.post('NEW');
  assert.equal(readdirSync(app.paths.logDir).length, 2);
});

test('AI 생성 중 사람 입력을 저장하고 중복 호출·오래된 AI 응답을 거부한다', async t => {
  let release, begun;
  const started = new Promise(resolve => { begun = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const app = await setup(t, { credential: 'mock-only', decideAction: async (game, request, _key, builder) => {
    calls++; assert.equal(builder, buildHumanlikeTurn); begun(); await gate;
    return { actor: 'ai1', action: { type: 'CHAT', text: 'STALE_MESSAGE', speechAct: 'OTHER' }, mode: 'gemini' };
  } });
  await app.post('NEW'); await app.post('START');
  const pending = app.post('ADVANCE', {}, 409);
  await started;
  await app.post('ADVANCE', {}, 409);
  await app.post('CHAT', { text: '새 질문을 먼저 처리해 주세요.' });
  release(); await pending;
  assert.equal(calls, 1);
  assert.ok(!app.game.messages.some(m => m.text === 'STALE_MESSAGE'));
  assert.ok(app.game.messages.some(m => m.actor === 'human'));
});

test('모델 장애는 비공개 오류 기록과 침묵으로 처리하고 사람이 진행할 수 있다', async t => {
  const app = await setup(t, { credential: 'mock-only', decideAction: async () => { throw Object.assign(new Error('PRIVATE_ERROR_TEXT'), { code: 'HTTP_503' }); } });
  await app.post('NEW'); await app.post('START');
  const result = await app.post('ADVANCE');
  assert.ok(result.notice.includes('오류'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_ERROR_TEXT'));
  const state = JSON.parse(readFileSync(join(app.paths.dataDir, 'session.json'), 'utf8'));
  assert.equal(state.aiFailures[0].error_code, 'HTTP_503');
  assert.ok(!JSON.stringify(state).includes('PRIVATE_ERROR_TEXT'));
  await app.post('PAUSE'); assert.equal(app.game.paused, true);
});

test('외부 Origin/Host·비 JSON·큰 요청을 거부하고 프롬프트/설정을 노출하지 않는다', async t => {
  const app = await setup(t);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(app.base + '/api/game', { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(app.base + '/api/game', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{"type":"NEW"}' })).status, 403);
  assert.equal((await fetch(app.base + '/api/game', { method: 'POST', body: '{"type":"NEW"}' })).status, 415);
  assert.equal((await fetch(app.base + '/api/game', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(9000) }) })).status, 413);
  for (const path of ['/.env.local', '/server.mjs', '/api/prompt']) assert.equal((await fetch(app.base + path)).status, 404);
});

function mockJev(choice = 'WAIT') {
  const ids = ['ai1', 'ai2', 'ai3', 'ai4', 'WAIT'];
  return Response.json({ model: JEV_MODEL, usage: { input_tokens: 3000 }, answers: {
    responder: { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(ids.map(id => [id, id === choice ? 1 : 0])) },
    speechAct: { type: 'choice', choice: 'OTHER', confidence: 1, probabilities: Object.fromEntries(SPEECH_ACTS.map(id => [id, id === 'OTHER' ? 1 : 0])) },
  } });
}

test('로컬 모드 선택·종료 비교 요약·기록·재시작을 확인하고 키/개별 판단을 숨긴다', async t => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0, jevCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.typesafe.ai')) { jevCalls++; return mockJev(); }
    if (String(url).includes('generativelanguage')) { geminiCalls++; throw new Error('MOCK_MODEL_FAILURE'); }
    return originalFetch(url, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await setup(t, { credential: 'mock-only', routingKey: 'PRIVATE_TEST_KEY' });
  await app.post('NEW', { routingMode: 'jev' }); await app.post('START');
  await app.post('CHAT', { text: '좋아요.' });
  const published = await app.post('ADVANCE');
  assert.equal(jevCalls, 1); assert.equal(geminiCalls, 0);
  assert.ok(!published.routingSummary && !JSON.stringify(published).includes('probabilities'));
  assert.ok(!JSON.stringify(published).includes('PRIVATE_TEST_KEY'));
  const saved = JSON.parse(readFileSync(join(app.paths.dataDir, 'session.json'), 'utf8'));
  assert.equal(saved.routingAttempts[0].outcome, 'PUBLISHED');
  assert.equal(saved.events.at(-1).detail.routing.jevChoice, 'WAIT');
  const previousId = app.game.id;
  await app.post('NEW', { routingMode: 'baseline' });
  const archived = JSON.parse(readFileSync(join(app.paths.logDir, `avalon-${previousId}.json`), 'utf8'));
  assert.equal(archived.routingAttempts.length, 1); assert.equal(archived.game.aiConfig.routingMode, 'jev');
  await app.post('START'); await app.post('CHAT', { text: '안녕하세요.' });
  await app.post('ADVANCE'); assert.equal(jevCalls, 1);
  const before = app.game.id;
  await app.post('NEW', { routingMode: 'invalid' }, 400); assert.equal(app.game.id, before);
  const restored = createPrototype({ ...app.paths, credential: 'mock-only', routingKey: 'PRIVATE_TEST_KEY' });
  await new Promise(resolve => restored.listen(0, '127.0.0.1', resolve));
  const data = await (await originalFetch(`http://127.0.0.1:${restored.address().port}/api/game`)).json();
  assert.equal(data.routingMode, 'baseline');
  await new Promise(resolve => restored.close(resolve));
});

test('느린 JEV 중 사람 입력·새 판은 낡은 결과를 폐기하고 기존 판에 사용량을 보존한다', async t => {
  const originalFetch = globalThis.fetch;
  let release, begun;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { begun = resolve; });
  let jevCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.typesafe.ai')) { jevCalls++; begun(); await gate; return mockJev(); }
    if (String(url).includes('generativelanguage')) assert.fail('WAIT에서는 Gemini 호출 금지');
    return originalFetch(url, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await setup(t, { credential: 'mock-only', routingKey: 'mock-only' });
  await app.post('NEW', { routingMode: 'jev' }); await app.post('START'); await app.post('CHAT', { text: '먼저 이야기해요.' });
  const previousId = app.game.id;
  const pending = app.post('ADVANCE', {}, 409);
  await started; await app.post('ADVANCE', {}, 409);
  await app.post('CHAT', { text: '새 질문입니다.' });
  await app.post('NEW', { routingMode: 'shadow' });
  release(); await pending;
  const archived = JSON.parse(readFileSync(join(app.paths.logDir, `avalon-${previousId}.json`), 'utf8'));
  assert.equal(jevCalls, 1); assert.equal(archived.routingAttempts[0].outcome, 'DISCARDED');
  assert.equal(archived.routingAttempts[0].inputTokens, 3000);
  assert.equal(app.game.messages.length, 0);
});

test('JEV 성공 뒤 Gemini 실패도 사용량과 생성 실패를 남긴다', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.typesafe.ai')) return mockJev('ai2');
    if (String(url).includes('generativelanguage')) return new Response('', { status: 401 });
    return originalFetch(url, init);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const app = await setup(t, { credential: 'mock-only', routingKey: 'mock-only' });
  await app.post('NEW', { routingMode: 'shadow' }); await app.post('START'); await app.post('CHAT', { text: '이 팀은 어때요?' });
  await app.post('ADVANCE');
  const saved = JSON.parse(readFileSync(join(app.paths.dataDir, 'session.json'), 'utf8'));
  assert.equal(saved.routingAttempts[0].inputTokens, 3000);
  assert.equal(saved.routingAttempts[0].outcome, 'GENERATION_FAILURE');
  assert.equal(saved.events.at(-1).detail.routing.status, 'OK');
});
