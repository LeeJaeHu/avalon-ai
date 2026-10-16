import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, observe, observeModerator, IDS, syncAssessmentSchedule } from '../lib/game.mjs';
import { decide, nextAiAction } from '../lib/ai.mjs';
import { ASSESSMENT_VERSION, nextAssessment, assessmentPrompt, applyAssessment } from '../lib/event-assessment.mjs';
import { actionPayload, MINIMUM_EVIL_TEAM_GUIDANCE } from '../lib/action-selection.mjs';
import { routingPayload } from '../lib/discussion-routing.mjs';
import { manualNextStep } from '../lib/conversation.mjs';
import { rememberThinking } from '../lib/thinking-memory.mjs';
import { newGameGeminiGeneration } from '../lib/gemini-models.mjs';

const plan = { situation: '팀 구성 확인', advantage: 'UNCERTAIN', basis: '공개 원정 결과 없음', speechPlan: '선정 이유를 질문', nextAction: '근거 확인 후 찬반 선택' };
function setup() {
  let game = createGame(() => .5); game.leader = 'human';
  game.roles = { human: 'LOYAL', ai1: 'ASSASSIN', ai2: 'MINION', ai3: 'MERLIN', ai4: 'LOYAL' };
  game.aiConfig = { assessmentVersion: ASSESSMENT_VERSION, manualProgress: true, conversationVersion: 1,
    actionMode: 'jev', model: 'gemini-3.5-flash-lite', ...newGameGeminiGeneration('gemini-3.5-flash-lite') };
  game = apply(game, 'human', { type: 'START' });
  return apply(game, 'human', { type: 'PROPOSE', team: ['ai1', 'ai2'] });
}
const decision = game => ({ ...nextAssessment(game), sourceVersion: game.version, status: 'OK', assessment: plan });
const finish = game => { while (nextAssessment(game)) game = applyAssessment(game, decision(game)); return game; };
const response = value => ({ ok: true, json: async () => ({ modelVersion: 'gemini-3.5-flash-lite', usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 15 }, candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }) });

test('AI 리더는 제안 전 한 번, 나머지 AI는 발표 후 판단하며 수정 때 순서를 반복한다', () => {
  let g = createGame(() => .5); g.leader = 'ai1'; g.aiConfig = { assessmentVersion: ASSESSMENT_VERSION, conversationVersion: 1, manualProgress: true };
  g = apply(g, 'human', { type: 'START' });
  assert.equal(nextAssessment(g).actor, 'ai1'); assert.equal(g.pendingAssessment.kind, 'BEFORE_PROPOSE');
  assert.ok(assessmentPrompt(g, nextAssessment(g)).includes('팀을 제안하거나 수정하기 직전'));
  assert.throws(() => apply(g, 'ai1', { type: 'PROPOSE', team: ['ai1', 'human'] }));
  g = finish(g); const leaderPlan = g.privateAssessments.ai1.eventId;
  syncAssessmentSchedule(g); assert.equal(nextAssessment(g), null);
  g = apply(g, 'ai1', { type: 'PROPOSE', team: ['ai1', 'human'] });
  assert.deepEqual(g.pendingAssessment.actors, ['ai2', 'ai3', 'ai4']);
  assert.equal(g.privateAssessments.ai1.eventId, leaderPlan);
  g = finish(g); g = apply(g, 'human', { type: 'REQUEST_REVISION' });
  assert.equal(nextAssessment(g).actor, 'ai1'); assert.notEqual(nextAssessment(g).eventId, leaderPlan);
  g = finish(g); g = apply(g, 'human', { type: 'DEFER_VOTE' });
  assert.equal(nextAssessment(g), null);
  g = apply(g, 'ai1', { type: 'PROPOSE', team: ['ai1', 'ai2'] });
  assert.deepEqual(g.pendingAssessment.actors, ['ai2', 'ai3', 'ai4']);
});

test('부결/다음 원정의 새 리더를 판단하고 구판 원정 결과 큐는 제거한다', () => {
  let g = finish(setup()); g = apply(g, 'system', { type: 'SILENCE' }); g = apply(g, 'human', { type: 'START_VOTE' });
  for (const actor of IDS) g = apply(g, actor, { type: 'VOTE', choice: 'REJECT' });
  g = apply(g, 'system', { type: 'SILENCE' }); g = apply(g, 'human', { type: 'CONTINUE' });
  assert.equal(g.leader, 'ai1'); assert.equal(nextAssessment(g).actor, 'ai1'); assert.equal(g.pendingAssessment.kind, 'BEFORE_PROPOSE');
  g = finish(g); syncAssessmentSchedule(g); assert.equal(nextAssessment(g), null);
  g.phase = 'QUEST_RESULT'; g.quests = [{ result: 'FAIL', team: ['human', 'ai1'], fails: 1 }];
  g.pendingAssessment = { eventId: 'legacy-result', kind: 'QUEST_RESULT', actors: IDS.slice(1) };
  syncAssessmentSchedule(g); assert.equal(nextAssessment(g), null);
  g.pendingDiscussion = null; g.pendingSpeech = null;
  g = apply(g, 'human', { type: 'CONTINUE' });
  assert.equal(g.leader, 'ai2'); assert.equal(nextAssessment(g).actor, 'ai2');
});

test('최소 악 인원은 악의 개인 판단/JEV 선호로만 전달하고 모든 합법 팀을 보존한다',()=>{
  const game=setup();game.privateAssessments={ai2:{assessment:{basis:'OTHER_PRIVATE_PLAN'}}};
  for(const actor of ['ai1','ai2']){
    const {payload,candidates}=actionPayload(game,{actor,type:'PROPOSE'});
    assert.ok(payload.questions.action.instructions.includes(MINIMUM_EVIL_TEAM_GUIDANCE));
    const prompt=assessmentPrompt(game,{actor});assert.ok(prompt.includes(MINIMUM_EVIL_TEAM_GUIDANCE));
    assert.equal(Object.keys(candidates).length,10);
    assert.ok(Object.values(candidates).some(c=>c.team.includes('ai1')&&c.team.includes('ai2')));
    assert.ok(Object.values(candidates).some(c=>c.team.includes(actor)&&c.team.includes('human')));
    if(actor==='ai1')assert.ok(!prompt.includes('OTHER_PRIVATE_PLAN'));
  }
  for(const actor of ['ai3','ai4']){
    assert.ok(!assessmentPrompt(game,{actor}).includes(MINIMUM_EVIL_TEAM_GUIDANCE));
    assert.ok(!actionPayload(game,{actor,type:'PROPOSE'}).payload.questions.action.instructions.includes(MINIMUM_EVIL_TEAM_GUIDANCE));
  }
});

test('각 사건에 네 명이 한 번 판단하고 채팅/단계/대화 횟수를 바꾸지 않는다', () => {
  let game = setup(); const before = structuredClone(game);
  assert.equal(nextAiAction(game).type, 'THINK');
  assert.equal(manualNextStep(observe(game)).disabled, true);
  assert.throws(() => apply(game, 'human', { type: 'START_VOTE' }));
  const actors = [];
  while (nextAssessment(game)) { actors.push(nextAiAction(game).actor); game = applyAssessment(game, decision(game)); }
  assert.deepEqual(actors, IDS.slice(1)); assert.equal(game.version, before.version + 4);
  for (const key of ['messages', 'publicEvents', 'conversation', 'phase', 'pendingDiscussion']) assert.deepEqual(game[key], before[key]);
  assert.equal(nextAiAction(game).type, 'DISCUSS');
  const chat = apply(game, 'ai1', { type: 'CHAT', text: '선정 이유는?', speechAct: 'QUESTION' });
  assert.equal(nextAssessment(chat), null);
  const revised = apply(game, 'human', { type: 'PROPOSE', team: ['human', 'ai4'] });
  assert.notEqual(nextAssessment(revised).eventId, before.pendingAssessment.eventId);
  assert.deepEqual(revised.pendingAssessment.actors, IDS.slice(1));
  const legacy = createGame(() => .5); legacy.leader = 'human';
  assert.equal(nextAssessment(apply(apply(legacy, 'human', { type: 'START' }), 'human', { type: 'PROPOSE', team: ['human', 'ai1'] })), null);
});

test('투표/원정 결과에는 판단을 추가하지 않고 최종 역할 추측은 기존 시점에 유지한다', () => {
  let game = finish(setup()); game = apply(game, 'system', { type: 'SILENCE' });
  game = apply(game, 'human', { type: 'START_VOTE' });
  for (const actor of IDS) game = apply(game, actor, { type: 'VOTE', choice: 'APPROVE' });
  assert.equal(nextAssessment(game), null);
  game = apply(game, 'system', { type: 'SILENCE' }); game = apply(game, 'human', { type: 'CONTINUE' });
  game = apply(game, 'ai1', { type: 'CARD', choice: 'FAIL' });
  game = apply(game, 'ai2', { type: 'CARD', choice: 'SUCCESS' });
  assert.equal(game.phase, 'QUEST_RESULT'); assert.equal(nextAssessment(game), null);
  assert.equal(nextAiAction(game).type, 'DISCUSS');
  game.aiConfig.roleGuessVersion = 'pre-end-v2';
  game.quests = [{ result: 'SUCCESS' }, { result: 'SUCCESS' }, { result: 'SUCCESS' }];
  assert.equal(nextAiAction(game), null);
});

test('개인 판단 입력과 JEV/대화에는 본인만, 공개 관찰/중립 라우터에는 판단 없음', async () => {
  let game = finish(setup());
  for (const actor of IDS.slice(1)) game.privateAssessments[actor].assessment.situation = `PRIVATE_${actor}`;
  game.privateCards = [{ actor: 'ai1', choice: 'FAIL' }, { actor: 'ai2', choice: 'SECRET_OTHER_CARD' }];
  game.votes = { ai2: 'SECRET_OTHER_VOTE' };
  game.privateThinking = { ai1: { text: 'OWN_MEMORY' }, ai2: { text: 'OTHER_MEMORY' } };
  for (const actor of IDS.slice(1)) {
    const prompt = assessmentPrompt(game, { actor });
    const payload = JSON.stringify(actionPayload(game, { actor, type: 'VOTE' }));
    for (const text of [prompt, payload]) {
      assert.ok(text.includes(`PRIVATE_${actor}`));
      for (const other of IDS.slice(1).filter(id => id !== actor)) assert.ok(!text.includes(`PRIVATE_${other}`));
      if (actor !== 'ai2') assert.ok(!text.includes('SECRET_OTHER_CARD') && !text.includes('SECRET_OTHER_VOTE'));
    }
  }
  for (const view of [observe(game), observeModerator(game), routingPayload(game, { type: 'DISCUSS' })]) assert.ok(!JSON.stringify(view).includes('PRIVATE_'));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.ok(prompt.includes('PRIVATE_ai1')); assert.ok(!prompt.includes('PRIVATE_ai2'));
      return response({ type: 'CHAT', text: '선정 이유를 확인하겠습니다.', speechAct: 'QUESTION', thinking: 'CHAT_MEMORY' });
    };
    const result = await decide(game, { actor: 'ai1', type: 'CHAT' }, 'mock');
    const next = apply(game, 'ai1', result.action); rememberThinking(next, result);
    assert.equal(next.privateAssessments.ai1.assessment.situation, 'PRIVATE_ai1');
  } finally { globalThis.fetch = original; }
});

test('실제 생성 경로는 판의 모델/추론 설정과 사용량을 기록하고 구조화 판단을 저장한다', async () => {
  let game = setup(); const original = globalThis.fetch; const usage = []; let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++; assert.ok(url.includes('gemini-3.5-flash-lite'));
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, game.aiConfig.thinkingLevel);
      assert.equal(body.generationConfig.maxOutputTokens, 8192);
      return response({ type: 'THINK', assessment: { ...plan, ignored: 'DROP_ME' } });
    };
    const result = await decide(game, nextAiAction(game), 'mock', null, { onUsage: r => usage.push(r) });
    game = applyAssessment(game, result);
    assert.deepEqual(game.privateAssessments.ai1.assessment, plan); assert.equal(calls, 1);
    assert.deepEqual(usage.map(r => r.status), ['REQUESTED', 'RESPONDED']);
    assert.equal(usage[1].requestType, 'THINK'); assert.equal(usage[1].eventId, game.pendingAssessment.eventId);
    assert.equal(usage[1].costUsd, 45 / 1e6);
    assert.equal(nextAiAction(game).actor, 'ai2');
  } finally { globalThis.fetch = original; }
});

test('실패/무효 출력은 재시도 없이 처리 완료, 이후 기존 JEV 입력과 다음 AI를 사용한다', async () => {
  const original = globalThis.fetch;
  try {
    for (const mock of [async () => ({ ok: false, status: 503 }), async () => response({ type: 'THINK', assessment: { ...plan, basis: '' } }), async () => response({ type: 'THINK', assessment: { ...plan, speechPlan: 'a'.repeat(601) } }), async () => response({ type: 'CHAT', assessment: plan })]) {
      let calls = 0; let game = setup(); globalThis.fetch = async (...args) => { calls++; return mock(...args); };
      const request = nextAiAction(game);
      let error;
      try { await decide(game, request, 'mock'); } catch (caught) { error = caught; }
      assert.ok(error); assert.equal(calls, 1);
      game = applyAssessment(game, { ...request, sourceVersion: game.version, status: 'FAILED', errorCode: error.code });
      assert.equal(game.privateAssessments.ai1.assessment, null);
      assert.equal(actionPayload(game, { actor: 'ai1', type: 'VOTE' }).payload.state.self.eventAssessment.status, 'FAILED');
      assert.equal(nextAiAction(game).actor, 'ai2');
    }
    const game = setup(); const noModel = await decide(game, nextAiAction(game), null);
    assert.equal(applyAssessment(game, noModel).privateAssessments.ai1.status, 'NO_MODEL');
  } finally { globalThis.fetch = original; }
});

test('정지/새 채팅/새 사건/중복 채택의 오래된 결과를 폐기한다', () => {
  const game = setup(); const result = decision(game);
  const current = applyAssessment(game, result);
  assert.throws(() => applyAssessment(current, result), e => e.code === 'STALE_STATE');
  for (const changed of [apply(game, 'human', { type: 'PAUSE' }), apply(game, 'human', { type: 'CHAT', text: '다른 팀은?', speechAct: 'QUESTION' }), apply(game, 'human', { type: 'PROPOSE', team: ['human', 'ai4'] })])
    assert.throws(() => applyAssessment(changed, result), e => e.code === 'STALE_STATE');
  assert.throws(() => applyAssessment(game, { ...result, eventId: 'other-event' }), e => e.code === 'STALE_STATE');
});

test('실제 JEV 선택 경로는 개인 판단과 사건 참조를 받고 합법 선택을 적용한다', async () => {
  const game = finish(setup()); const records = []; let calls = 0;
  const result = await decide(game, { type: 'VOTE', actor: 'ai1' }, 'mock-gemini', null, {
    key: 'mock-jev', onUsage: r => records.push(r), fetchImpl: async (_url, options) => {
      calls++; const payload = JSON.parse(options.body);
      assert.deepEqual(payload.state.self.eventAssessment.assessment, plan);
      assert.equal(payload.state.self.eventAssessment.eventId, game.pendingAssessment.eventId);
      return { ok: true, json: async () => ({ model: 'jev-1.13.0', usage: { input_tokens: 100 }, answers: { action: {
        type: 'choice', choice: 'REJECT', confidence: .9, probabilities: { APPROVE: .1, REJECT: .9 },
      } } }) };
    },
  });
  assert.equal(calls, 1); assert.deepEqual(result.action, { type: 'VOTE', choice: 'REJECT' });
  assert.equal(result.selection.assessmentEventId, game.pendingAssessment.eventId);
  assert.ok(records.every(r => r.assessmentEventId === game.pendingAssessment.eventId));
});
