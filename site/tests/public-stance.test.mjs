import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply } from '../lib/game.mjs';
import { actionPayload } from '../lib/action-selection.mjs';
import { assessmentPrompt } from '../lib/event-assessment.mjs';
import { routingPayload } from '../lib/discussion-routing.mjs';
import { publicStance, PUBLIC_STANCE_GUIDANCE, publicStanceGuidance, newGameEndgameExposure } from '../lib/public-stance.mjs';
import { buildPromptV3 } from '../lib/prompts/v3.mjs';
import { observe, observeModerator } from '../lib/game.mjs';
import { decide } from '../lib/ai.mjs';

function fixture() {
  let g = createGame(() => .5); g.leader = 'human';
  g.roles = { human: 'LOYAL', ai1: 'ASSASSIN', ai2: 'LOYAL', ai3: 'MERLIN', ai4: 'MINION' };
  g = apply(g, 'human', { type: 'START' });
  g = apply(g, 'ai3', { type: 'CHAT', text: '이전 팀에 대한 의견', speechAct: 'OTHER' });
  g = apply(g, 'human', { type: 'PROPOSE', team: ['human', 'ai1'] });
  g = apply(g, 'human', { type: 'CHAT', text: '하린을 넣은 이유가 있나요?', speechAct: 'QUESTION' });
  g.privateAssessments = { ai3: { status: 'OK', assessment: { speechPlan: '아직 말하지 않은 우려' } }, ai1: { assessment: { basis: 'OTHER_PRIVATE_PLAN' } } };
  g.votes = { ai1: 'OTHER_PRIVATE_VOTE' };
  return g;
}

test('새 판은 막판 노출 OFF가 기본이고 명시 boolean만 허용하며 구판은 기존 ON 해석을 유지한다', () => {
  assert.equal(newGameEndgameExposure(undefined), false);
  assert.equal(newGameEndgameExposure(true), true);
  assert.equal(newGameEndgameExposure(false), false);
  for (const value of ['false', 0, null, {}, []]) assert.throws(() => newGameEndgameExposure(value));
  assert.ok(publicStanceGuidance().includes('막판 정체 노출 허용: ON'));
  for (const allowed of [false, true]) {
    const g = fixture(); g.aiConfig = { endgameExposureAllowed: allowed };
    const { payload, candidates } = actionPayload(g, { actor: 'ai3', type: 'VOTE' });
    const flag = `막판 정체 노출 허용: ${allowed ? 'ON' : 'OFF'}`;
    assert.equal(payload.state.self.endgameExposureAllowed, allowed);
    assert.ok(payload.questions.action.instructions.includes(flag));
    assert.ok(assessmentPrompt(g, { actor: 'ai3' }).includes(flag));
    const chat = buildPromptV3({ request: { actor: 'ai3', type: 'CHAT' }, view: observe(g, 'ai3'), publicState: observeModerator(g), personalInfo: { endgameExposureAllowed: allowed } });
    assert.ok(chat.includes(flag)); assert.ok(!chat.includes(`막판 정체 노출 허용: ${allowed ? 'OFF' : 'ON'}`));
    assert.deepEqual(Object.keys(candidates), ['APPROVE', 'REJECT']);
  }
});

test('계획/타인의 우려를 본인의 실제 발언으로 간주하지 않고 팀 제안 전후를 분리한다', () => {
  let g = fixture();
  assert.deepEqual(publicStance(g, 'ai3').currentTeamStatements, []);
  assert.equal(publicStance(g, 'ai3').previousStatements.length, 1);
  g = apply(g, 'ai3', { type: 'CHAT', text: '성공 멤버 교체 이유가 충분하지 않아 우려됩니다.', speechAct: 'CHALLENGE' });
  assert.equal(publicStance(g, 'ai3').currentTeamStatements.length, 1);
  assert.equal(publicStance(g, 'ai3').currentTeamStatements[0].text, g.messages.at(-1).text);
  g = apply(g, 'human', { type: 'PROPOSE', team: ['human', 'ai2'] });
  assert.deepEqual(publicStance(g, 'ai3').currentTeamStatements, []);
  assert.equal(publicStance(g, 'ai3').previousStatements.length, 2);
  delete g.publicEvents.at(-1).messageCount;
  assert.equal(publicStance(g, 'ai3').boundaryStatus, 'UNAVAILABLE');
  assert.equal(publicStance(g, 'ai3').unclassifiedStatements.length, 2);
});

test('은폐와 즉시 패배를 함께 비교하도록 입력하고 찬반 후보/비밀 경계를 보존한다', () => {
  const g = fixture();
  for (const [successes, failures, attempt] of [[2, 0, 1], [0, 2, 1], [2, 0, 5]]) {
    g.quests = [...Array.from({ length: successes }, () => ({ result: 'SUCCESS', team: ['human', 'ai2'], fails: 0 })), ...Array.from({ length: failures }, () => ({ result: 'FAIL', team: ['human', 'ai1'], fails: 1 }))];
    g.attempt = attempt;
    const { payload, candidates } = actionPayload(g, { actor: 'ai3', type: 'VOTE' });
    assert.deepEqual(Object.keys(candidates), ['APPROVE', 'REJECT']);
    assert.equal(payload.state.public.successes, successes);
    assert.equal(payload.state.public.failures, failures);
    assert.equal(payload.state.public.attempt, attempt);
    assert.ok(payload.questions.action.instructions.includes(PUBLIC_STANCE_GUIDANCE));
    assert.deepEqual(payload.state.self.publicStance.currentTeamStatements, []);
    assert.ok(assessmentPrompt(g, { actor: 'ai3' }).includes(PUBLIC_STANCE_GUIDANCE));
    const personal = JSON.stringify(payload);
    assert.ok(!personal.includes('OTHER_PRIVATE_PLAN') && !personal.includes('OTHER_PRIVATE_VOTE'));
  }
  const router = routingPayload(g, { type: 'DISCUSS' });
  assert.ok(!JSON.stringify(router).includes('아직 말하지 않은 우려'));
  assert.ok(!JSON.stringify(router).includes('OTHER_PRIVATE'));
  assert.ok(router.questions.responder.instructions.includes('distinct public concern'));
  g.phase = 'QUEST_RESULT'; g.quests = Array.from({ length: 3 }, () => ({ result: 'SUCCESS', team: ['human', 'ai2'], fails: 0 }));
  assert.equal(actionPayload(g, { actor: 'ai3', type: 'VOTE' }).payload.state.public.afterCurrentResult, 'ASSASSINATE');
  g.quests = Array.from({ length: 3 }, () => ({ result: 'FAIL', team: ['human', 'ai1'], fails: 1 }));
  assert.equal(actionPayload(g, { actor: 'ai3', type: 'VOTE' }).payload.state.public.afterCurrentResult, 'EVIL_WINS');
});

test('기존 Gemini 발언 경로에 공개 입장과 사전 우려 지침을 추가 호출 없이 전달한다', async () => {
  const g = fixture(); const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++; const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.ok(prompt.includes(PUBLIC_STANCE_GUIDANCE));
      assert.ok(prompt.includes('"currentTeamStatements":[]'));
      assert.ok(!prompt.includes('OTHER_PRIVATE_PLAN') && !prompt.includes('OTHER_PRIVATE_VOTE'));
      return Response.json({ usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'CHAT', text: '성공 멤버를 교체한 이유가 궁금합니다.', speechAct: 'QUESTION', thinking: '공개 질문으로 확인' }) }] } }] });
    };
    const result = await decide(g, { actor: 'ai3', type: 'CHAT' }, 'mock');
    assert.equal(result.action.type, 'CHAT'); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
