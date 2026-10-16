import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, IDS } from '../lib/game.mjs';
import { newGameDiscussionPolicy, playerDiscussionPayload } from '../lib/player-discussion.mjs';
import { routeDiscussion, JEV_MODEL } from '../lib/discussion-routing.mjs';
import { decide } from '../lib/ai.mjs';
import { speechContext, SPEECH_OWNERSHIP_GUIDANCE } from '../lib/public-stance.mjs';

function setup() {
  let g = createGame(() => .5); g.leader = 'human';
  g.roles = { human: 'LOYAL', ai1: 'ASSASSIN', ai2: 'MINION', ai3: 'MERLIN', ai4: 'LOYAL' };
  g = apply(g, 'human', { type: 'START' });
  g = apply(g, 'human', { type: 'PROPOSE', team: ['human', 'ai1'] });
  g.aiConfig = { routingMode: 'jev', discussionPolicy: 'player', manualProgress: true, conversationVersion: 1 };
  g.privateAssessments = Object.fromEntries(IDS.slice(1).map(actor => [actor, { status: 'OK', assessment: { speechPlan: `PRIVATE_${actor}` } }]));
  g.votes = { ai2: 'OTHER_PRIVATE_VOTE' };
  g.privateCards = [{ actor: 'ai2', choice: 'OTHER_PRIVATE_CARD' }];
  return g;
}
const reply = choice => Response.json({ model: JEV_MODEL, usage: { input_tokens: 1000 }, answers: {
  intent: { type: 'choice', choice, confidence: .8, probabilities: { TALK: choice === 'TALK' ? .8 : .2, WAIT: choice === 'WAIT' ? .8 : .2 } } } });

test('도윤 제안·하린 반대·서아 찬성의 행동 주체와 인용 원저자를 구분한다', () => {
  let g = setup(); g.proposals.at(-1).leader = 'ai2'; g.proposals.at(-1).status = 'APPROVED';
  g.proposals.at(-1).votes = IDS.map(actor => ({ actor, choice: actor === 'ai1' ? 'REJECT' : 'APPROVE' }));
  g = apply(g, 'ai2', { type: 'CHAT', text: '조합을 넓혀 검증하려고 제안했습니다.', speechAct: 'DEFENSE' });
  const quoted = g.messages.at(-1).id;
  g = apply(g, 'ai1', { type: 'CHAT', text: '그 취지는 이해하지만 구성을 더 따져보고 싶습니다.', speechAct: 'CHALLENGE', replyTo: quoted });
  const request = { type: 'DISCUSS', replyTo: g.messages.at(-1).id };
  const context = speechContext(g, 'ai3', request);
  assert.equal(context.proposalAuthor, 'ai2'); assert.equal(context.isProposalAuthor, false);
  assert.equal(context.ownPublishedVote, 'APPROVE'); assert.deepEqual(context.rejectedBy, ['ai1']);
  assert.equal(context.focus.actor, 'ai1'); assert.equal(context.quoted.actor, 'ai2');
  const p = playerDiscussionPayload(g, request, 'ai3'); assert.deepEqual(p.state.self.speechContext, context);
  assert.ok(p.questions.intent.instructions.includes(SPEECH_OWNERSHIP_GUIDANCE));
  g.proposals.at(-1).status = 'PENDING';
  assert.deepEqual(speechContext(g, 'ai3', request).rejectedBy, []);
  assert.equal(speechContext(g, 'ai3', request).ownPublishedVote, null);
});

test('설정과 개인 관찰은 본인만 포함하고 중립 화자 선택 후보는 전달하지 않는다', () => {
  assert.equal(newGameDiscussionPolicy(), 'player');
  for (const value of ['player', 'moderator']) assert.equal(newGameDiscussionPolicy(value), value);
  for (const value of [null, '', {}, true]) assert.throws(() => newGameDiscussionPolicy(value));
  const g = setup();
  for (const actor of IDS.slice(1)) {
    const p = playerDiscussionPayload(g, { type: 'DISCUSS', topic: 'team' }, actor); const text = JSON.stringify(p);
    assert.ok(text.includes(`PRIVATE_${actor}`));
    for (const other of IDS.slice(1).filter(id => id !== actor)) assert.ok(!text.includes(`PRIVATE_${other}`));
    if (actor !== 'ai2') assert.ok(!text.includes('OTHER_PRIVATE_VOTE') && !text.includes('OTHER_PRIVATE_CARD'));
    assert.deepEqual(Object.keys(p.questions), ['intent']); assert.equal(p.state.candidates, undefined);
    assert.equal(p.state.request.type, 'DISCUSSION_INTENT'); assert.equal(p.state.trigger.topic, 'team');
  }
});

test('JEV4회 동시성2로 의사를 분리하고 사용량은 네 호출로 기록한다', async () => {
  const g = setup(); const before = JSON.stringify(g); const usage = []; let active = 0, max = 0, calls = 0;
  const result = await routeDiscussion(g, { type: 'DISCUSS', topic: 'team' }, { mode: 'jev', key: 'mock', onUsage: r => usage.push(r),
    fetchImpl: async (_url, options) => {
      calls++; active++; max = Math.max(max, active); const p = JSON.parse(options.body);
      assert.ok(options.signal instanceof AbortSignal);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return reply(p.state.self.id === 'ai3' ? 'TALK' : 'WAIT');
    } });
  assert.equal(result.actor, 'ai3'); assert.equal(calls, 4); assert.equal(max, 2);
  assert.equal(result.record.intents.length, 4); assert.equal(result.record.inputTokens, 4000);
  assert.equal(usage.filter(r => r.status === 'REQUESTED').length, 4); assert.equal(usage.filter(r => r.status === 'OK').length, 4);
  assert.ok(usage.every(r => r.requestType === 'DISCUSSION_INTENT' && r.routingId === result.record.id));
  assert.equal(JSON.stringify(g), before);
});

test('전원 WAIT는 Gemini 미호출, 여러 TALK는 마지막 발언자 후순위, 직접 질문은 응답 보존', async () => {
  let g = setup(); const request = { type: 'DISCUSS', topic: 'team' };
  const waiting = await decide(g, request, 'mock-gemini', null, { key: 'mock', fetchImpl: async () => reply('WAIT') });
  assert.equal(waiting.action.type, 'SILENCE'); assert.equal(waiting.routing.intents.length, 4);
  g = apply(g, 'ai1', { type: 'CHAT', text: '제 생각은 이렇습니다.', speechAct: 'OTHER' });
  const all = await routeDiscussion(g, request, { mode: 'jev', key: 'mock', fetchImpl: async () => reply('TALK') });
  assert.equal(all.actor, 'ai2');
  g = apply(g, 'human', { type: 'CHAT', text: '서아님, 이 팀은 어떻게 보세요?', speechAct: 'QUESTION' });
  const addressed = await routeDiscussion(g, { type: 'DISCUSS', replyTo: g.messages.at(-1).id }, { mode: 'jev', key: 'mock', fetchImpl: async () => reply('WAIT') });
  assert.equal(addressed.actor, 'ai3'); assert.equal(addressed.record.addressedResponsePreserved, true);
});

test('부분 실패는 성공 판단을 사용하고 전체 실패/무키/정지는 기존 안전 경로를 유지한다', async () => {
  const g = setup(); let calls = 0;
  const result = await routeDiscussion(g, { type: 'DISCUSS' }, { mode: 'jev', key: 'mock', fetchImpl: async (_u, o) => {
    calls++; return JSON.parse(o.body).state.self.id === 'ai4' ? reply('TALK') : new Response('', { status: 503 });
  } });
  assert.equal(calls, 4); assert.equal(result.actor, 'ai4'); assert.equal(result.record.status, 'PARTIAL');
  for (const fetchImpl of [async () => new Response('', { status: 503 }), async () => Response.json({ model: 'wrong', usage: { input_tokens: 5 } }), async () => { throw Object.assign(new Error('secret'), { name: 'TimeoutError' }); }]) {
    const failed = await routeDiscussion(g, { type: 'DISCUSS' }, { mode: 'jev', key: 'mock', fetchImpl });
    assert.equal(failed.record.status, 'FALLBACK'); assert.equal(failed.record.intents.length, 4);
    assert.ok(!JSON.stringify(failed.record).includes('secret'));
  }
  const noKey = await routeDiscussion(g, { type: 'DISCUSS' }, { mode: 'jev' }); assert.equal(noKey.record.status, 'NO_KEY');
  const paused = await routeDiscussion({ ...g, paused: true }, { type: 'DISCUSS' }, { mode: 'jev', key: 'mock', fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(paused.actor, 'WAIT'); assert.equal(paused.record.status, 'INACTIVE');
});

test('의사 판단 후 선택된 한 명만 기존 Gemini로 발언을 생성한다', async () => {
  const g = setup(); const original = globalThis.fetch; let geminiCalls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      geminiCalls++; const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.ok(prompt.includes('PRIVATE_ai3') && !prompt.includes('PRIVATE_ai1'));
      assert.ok(prompt.includes(SPEECH_OWNERSHIP_GUIDANCE) && prompt.includes('"proposalAuthor":"human"'));
      return Response.json({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }, candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'CHAT', text: '성공 팀을 바꾼 이유를 확인하고 싶습니다.', speechAct: 'QUESTION', thinking: '공개 근거 확인' }) }] } }] });
    };
    const result = await decide(g, { type: 'DISCUSS', topic: 'team' }, 'mock-gemini', null, { key: 'mock', fetchImpl: async (_url, options) => reply(JSON.parse(options.body).state.self.id === 'ai3' ? 'TALK' : 'WAIT') });
    assert.equal(result.actor, 'ai3'); assert.equal(result.action.type, 'CHAT'); assert.equal(geminiCalls, 1);
  } finally { globalThis.fetch = original; }
});
