import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, createGame, observe } from '../lib/game.mjs';
import { weightedRoleAssignments } from '../lib/belief.mjs';
import { planTeam } from '../lib/team-planner.mjs';
import { decide } from '../lib/ai.mjs';

const fixture = () => {
  const game = createGame(() => 0.5);
  game.roles = { human: 'LOYAL', ai1: 'LOYAL', ai2: 'MERLIN', ai3: 'ASSASSIN', ai4: 'MINION' };
  game.leader = 'ai1';
  game.phase = 'PROPOSE';
  game.pendingDiscussion = null;
  return game;
};

test('같은 관찰값에서 합법적 후보 10개를 비교하고 결과가 재현된다', () => {
  const game = fixture();
  const view = observe(game, 'ai1');
  const first = planTeam(view, 'ai1');
  assert.equal(first.scores.length, 10);
  assert.equal(first.team.length, 2);
  assert.equal(new Set(first.team).size, 2);
  assert.deepEqual(planTeam(view, 'ai1'), first);
  assert.ok(first.scores.every(s => Number.isFinite(s.score)
    && s.approvalChance >= 0 && s.approvalChance <= 1
    && s.questSuccessChance >= 0 && s.questSuccessChance <= s.approvalChance));
  assert.notDeepEqual(planTeam(view, 'ai1', { rounds: 0 }).scores.map(s => s.score),
    first.scores.map(s => s.score));
});

test('공개 실패 카드로 모순된 역할 배정을 없애고 비공개 카드 변경에는 흔들리지 않는다', () => {
  const game = fixture();
  game.quests = [{ id: 'quest-1', team: ['ai1', 'ai3'], fails: 1, result: 'FAIL' }];
  const view = observe(game, 'ai1');
  const posterior = weightedRoleAssignments(view, 'ai1');
  assert.ok(posterior.length > 0);
  assert.ok(posterior.every(item => ['ASSASSIN', 'MINION'].includes(item.roles.ai3)));
  assert.ok(Math.abs(posterior.reduce((sum, item) => sum + item.probability, 0) - 1) < 1e-12);
  const before = planTeam(view, 'ai1');
  game.privateCards = [{ quest: 1, actor: 'ai3', choice: 'FAIL' }];
  game.votes = { ai4: 'REJECT' };
  assert.deepEqual(planTeam(observe(game, 'ai1'), 'ai1'), before);
  assert.ok(before.scores.find(item => item.team.includes('ai3')).score
    < before.scores.find(item => item.team.includes('human') && item.team.includes('ai1')).score);
});

test('A/B 배정은 판에 고정되고 B의 충신 리더만 계산기로 제안한다', async () => {
  const game = fixture();
  game.aiConfig = { proposalPolicy: 'B' };
  const chosen = await decide(game, { actor: 'ai1', type: 'PROPOSE' }, 'configured-key');
  assert.equal(chosen.mode, 'planner');
  assert.deepEqual(chosen.action.team, planTeam(observe(game, 'ai1'), 'ai1').team);
  assert.equal(apply(game, 'ai1', chosen.action).phase, 'VOTE');
  game.aiConfig.proposalPolicy = 'A';
  assert.equal((await decide(game, { actor: 'ai1', type: 'PROPOSE' }, '')).mode, 'practice');
  game.aiConfig.proposalPolicy = 'B';
  game.roles.ai1 = 'ASSASSIN';
  assert.equal((await decide(game, { actor: 'ai1', type: 'PROPOSE' }, '')).mode, 'practice');
});

test('충신 리더 이외의 호출과 잘못된 반복 횟수를 거부한다', () => {
  const view = observe(fixture(), 'ai1');
  assert.throws(() => planTeam(view, 'human'));
  assert.throws(() => planTeam(view, 'ai1', { rounds: -1 }));
  assert.throws(() => planTeam(view, 'ai1', { rounds: 11 }));
});
