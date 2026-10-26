import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, observe } from '../lib/game.mjs';
import { publicFacts, teamNote, PUBLIC_FACTS_GUIDANCE } from '../lib/public-facts.mjs';
import { actionPayload } from '../lib/action-selection.mjs';
import { assessmentPrompt } from '../lib/event-assessment.mjs';
import { playerDiscussionPayload } from '../lib/player-discussion.mjs';
import { decide } from '../lib/ai.mjs';

// 2026-10-26 bf889a72 판의 원정·투표 기록을 채팅 없이 재현한다.
const ROLES = { human: 'LOYAL', ai1: 'ASSASSIN', ai2: 'MINION', ai3: 'LOYAL', ai4: 'MERLIN' };
const votes = map => Object.entries(map).map(([actor, choice]) => ({ actor, choice: choice ? 'APPROVE' : 'REJECT' }));
const P1 = { id: 'proposal-1', quest: 1, attempt: 1, leader: 'human', team: ['human', 'ai1'], status: 'APPROVED',
  votes: votes({ human: 1, ai1: 1, ai2: 1, ai3: 1, ai4: 0 }) };
const P2 = { id: 'proposal-2', quest: 2, attempt: 1, leader: 'ai1', team: ['human', 'ai1', 'ai3'], status: 'APPROVED',
  votes: votes({ human: 0, ai1: 1, ai2: 1, ai3: 1, ai4: 0 }) };
const Q1 = { id: 'quest-1', proposalId: 'proposal-1', team: ['human', 'ai1'], fails: 1, result: 'FAIL' };
const Q2 = { id: 'quest-2', proposalId: 'proposal-2', team: ['human', 'ai1', 'ai3'], fails: 1, result: 'FAIL' };
function game(stage, roles = ROLES) {
  const g = { ...createGame(() => .5), roles: { ...roles }, aiConfig: { conversationVersion: 1, manualProgress: true, actionMode: 'jev', routingMode: 'jev' } };
  if (stage === 'Q1_CARD') Object.assign(g, { phase: 'QUEST', quest: 0, leader: 'human', team: ['human', 'ai1'], proposals: [P1], quests: [] });
  if (stage === 'Q3_PROPOSE') Object.assign(g, { phase: 'PROPOSE', quest: 2, leader: 'ai2', team: [], proposals: [P1, P2], quests: [Q1, Q2] });
  if (stage === 'Q3_VOTE') Object.assign(g, { phase: 'VOTE', quest: 2, leader: 'ai2', team: ['ai1', 'human'],
    proposals: [P1, P2, { id: 'proposal-3', quest: 3, attempt: 1, leader: 'ai2', team: ['ai1', 'human'], status: 'VOTING' }], quests: [Q1, Q2] });
  return g;
}
const facts = (g, actor) => publicFacts(observe(g, actor), actor);

test('실패팀과 같은 팀은 순서와 관계없이 공개 사실과 PROPOSE 후보 설명에 표시된다', () => {
  const g = game('Q3_VOTE');
  assert.deepEqual(facts(g, 'ai3').public.currentTeam.identicalToFailedQuests, ['quest-1']);
  assert.match(teamNote(['ai1', 'human'], g.quests), /1원정 실패팀과 동일/);
  assert.equal(teamNote(['ai3', 'ai4'], g.quests), ' [실패 원정 참가자 서아 포함]');
  assert.equal(teamNote(['ai2', 'ai4'], g.quests), '');
  const { payload } = actionPayload(game('Q3_PROPOSE'), { actor: 'ai2', type: 'PROPOSE' });
  const criteria = Object.values(payload.questions.action.criteria);
  assert.ok(criteria.some(c => c.startsWith('팀 유저(human), 하린(ai1)') && c.includes('1원정 실패팀과 동일')));
  assert.ok(criteria.some(c => c.includes('도윤(ai2), 지호(ai4)') && !c.includes('[')));
  const vote = actionPayload(g, { actor: 'ai3', type: 'VOTE' }).payload.questions.action.criteria;
  assert.match(vote.APPROVE, /1원정 실패팀과 동일/);
});

test('2인 원정에서 실패를 내면 동행자에게 확정 노출된다는 사실을 악에게 알려 준다', () => {
  const before = facts(game('Q1_CARD'), 'ai1').self;
  assert.deepEqual(before.exposedTo, []);
  assert.deepEqual(before.cardIfFail, { newlyCertainTo: ['human'], allyOnTeam: [] });
  const card = actionPayload(game('Q1_CARD'), { actor: 'ai1', type: 'CARD' }).payload;
  assert.deepEqual(card.state.self.publicFacts.cardIfFail.newlyCertainTo, ['human']);
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'ai1').self.exposedTo, ['human']);
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'ai2').self.exposedTo, []);
});

test('충신은 공개 기록으로 확정되는 악만 확정으로 받는다', () => {
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'human').self.certainEvil, ['ai1']);
  // 서아는 1원정에 없어서 유저와 하린 중 누가 실패했는지 확정할 수 없다.
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'ai3').self.certainEvil, []);
  const afterQ1 = { ...game('Q3_PROPOSE'), proposals: [P1], quests: [Q1] };
  assert.deepEqual(facts(afterQ1, 'human').self.certainEvil, ['ai1']);
  assert.deepEqual(facts(afterQ1, 'ai3').self.certainGood, []);
});

test('공개 근거 없는 정확한 반대는 멀린 신호로 집계된다', () => {
  const pub = facts(game('Q3_PROPOSE'), 'ai3').public.voteSignals;
  assert.equal(pub.ai4.unexplainedCorrectRejects, 1);
  assert.equal(pub.human.rejectedLaterFailed, 1);
  assert.equal(pub.human.unexplainedCorrectRejects, 0);
  const assassin = facts(game('Q3_PROPOSE'), 'ai1').self.merlinVoteSignals;
  assert.deepEqual(Object.keys(assassin).sort(), ['ai3', 'ai4', 'human']);
  assert.equal(assassin.ai4.unexplainedRejectMatches, 1);
  assert.equal(assassin.human.unexplainedRejectMatches, 0);
  assert.ok(assassin.ai3.mismatches >= 2);
  assert.equal(facts(game('Q3_PROPOSE'), 'ai4').self.ownMerlinSignal.unexplainedRejectMatches, 1);
});

test('공개 사실은 숨은 역할과 무관하고 선의 개인 관점에는 다른 사람의 역할이 들어가지 않는다', () => {
  const swapped = { ...ROLES, ai1: 'MINION', ai2: 'MERLIN', ai4: 'ASSASSIN' };
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'ai3').public, facts(game('Q3_PROPOSE', swapped), 'ai3').public);
  assert.deepEqual(facts(game('Q3_PROPOSE'), 'ai3').self, facts(game('Q3_PROPOSE', swapped), 'ai3').self);
  const loyal = facts(game('Q3_PROPOSE'), 'ai3').self;
  assert.deepEqual(Object.keys(loyal).sort(), ['certainEvil', 'certainGood', 'role']);
  const minion = facts(game('Q3_PROPOSE'), 'ai2').self;
  assert.equal(minion.merlinVoteSignals, undefined);
});

test('행동·상황 판단·발언 의사·채팅 입력에 공개 사실과 지침이 전달된다', async () => {
  const g = game('Q3_VOTE');
  const { payload } = actionPayload(g, { actor: 'ai2', type: 'VOTE' });
  assert.ok(payload.state.public.publicFacts && payload.state.self.publicFacts);
  assert.ok(payload.questions.action.instructions.includes(PUBLIC_FACTS_GUIDANCE));
  assert.ok(assessmentPrompt(g, { actor: 'ai2' }).includes(PUBLIC_FACTS_GUIDANCE));
  assert.ok(assessmentPrompt(g, { actor: 'ai2' }).includes('identicalToFailedQuests'));
  const intent = playerDiscussionPayload(g, { type: 'DISCUSS' }, 'ai2');
  assert.ok(intent.questions.intent.instructions.includes(PUBLIC_FACTS_GUIDANCE));
  assert.ok(intent.state.public.publicFacts.currentTeam);
  let body = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    body = init.body;
    return Response.json({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'SILENCE' }) }] } }] });
  };
  try { await decide(g, { type: 'CHAT', actor: 'ai2' }, 'mock'); } finally { globalThis.fetch = original; }
  assert.ok(body.includes('identicalToFailedQuests') && body.includes('publicFacts.public은'));
});
