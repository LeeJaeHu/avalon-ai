import test from 'node:test';
import assert from 'node:assert/strict';
import { roleClues, evilPosterior } from '../lib/belief.mjs';
import { IDS, observe } from '../lib/game.mjs';

test('충신의 역할 후보는 실패 임무의 논리 제약만 적용한다', () => {
  const view = { role: 'LOYAL', known: [], quests: [] };
  assert.deepEqual(roleClues(view, 'human'), { possibleAssignments: 24,
    evilCandidateCounts: { human: 0, ai1: 12, ai2: 12, ai3: 12, ai4: 12 },
    evilCandidateShares: { human: 0, ai1: 0.5, ai2: 0.5, ai3: 0.5, ai4: 0.5 },
    questTeamEvilShares: [], currentTeamEvilShares: null });
  view.quests = [{ team: ['human', 'ai1'], fails: 1 }];
  const afterFail = roleClues(view, 'human');
  assert.equal(afterFail.possibleAssignments, 12);
  assert.equal(afterFail.evilCandidateCounts.ai1, 12);
  assert.equal(afterFail.evilCandidateShares.ai1, 1);
  view.quests = [{ team: ['human', 'ai1'], fails: 0 }];
  assert.equal(roleClues(view, 'human').possibleAssignments, 24);
});

test('실패 임무의 공동 제약은 악이 한 명 또는 두 명인 후보를 모두 남긴다', () => {
  const view = { role: 'LOYAL', known: [], quests: [{ id: 1, team: ['ai1', 'ai2'], fails: 1 }], team: ['ai1', 'ai2'] };
  const clues = roleClues(view, 'human');
  assert.equal(clues.possibleAssignments, 20);
  assert.deepEqual(clues.questTeamEvilShares[0].evilMembers, { 0: 0, 1: 0.8, 2: 0.2 });
  assert.deepEqual(clues.currentTeamEvilShares, { 0: 0, 1: 0.8, 2: 0.2 });
  assert.equal(clues.evilCandidateShares.ai1, 0.6);
  assert.equal(clues.evilCandidateShares.ai2, 0.6);
});

test('멀린에게 알려진 악 둘만 확정 단서로 쓰고 실제 역할표는 받지 않는다', () => {
  const view = { role: 'MERLIN', known: ['ai1', 'ai3'], quests: [] };
  const clues = roleClues(view, 'human');
  assert.equal(clues.possibleAssignments, 2);
  assert.deepEqual(IDS.filter(id => clues.evilCandidateCounts[id] === 2), ['ai1', 'ai3']);
});

test('사전확률, 제안·투표, 실패와 성공 원정이 역할 확률에 반영된다', () => {
  const view = { role: 'LOYAL', known: [], proposals: [], quests: [] };
  const baseline = evilPosterior(view, 'human');
  assert.equal(baseline.evilProbability.human, 0);
  assert.equal(baseline.evilProbability.ai1, 0.5);
  assert.equal(Object.values(baseline.evilProbability).reduce((a, b) => a + b), 2);
  view.proposals = [{ leader: 'ai1', team: ['ai1', 'ai2'], attempt: 1,
    votes: [{ actor: 'ai1', choice: 'APPROVE' }, { actor: 'ai2', choice: 'APPROVE' },
      { actor: 'ai3', choice: 'REJECT' }, { actor: 'ai4', choice: 'REJECT' },
      { actor: 'human', choice: 'REJECT' }] }];
  const afterVote = evilPosterior(view, 'human');
  assert.notEqual(afterVote.evilProbability.ai1, baseline.evilProbability.ai1);
  view.quests = [{ team: ['human', 'ai1'], fails: 1 }];
  const afterFail = evilPosterior(view, 'human');
  assert.equal(afterFail.evilProbability.ai1, 1);
  view.quests = [{ team: ['human', 'ai1'], fails: 0 }];
  const afterSuccess = evilPosterior(view, 'human');
  assert.ok(afterSuccess.evilProbability.ai1 > 0);
  assert.ok(afterSuccess.evilProbability.ai1 < afterVote.evilProbability.ai1);
});

test('동일 공개 정보에도 자기 역할과 알려진 악에 따라 개인별 사후확률이 다르다', () => {
  const view = { role: 'MERLIN', known: ['ai1', 'ai3'], proposals: [], quests: [] };
  const posterior = evilPosterior(view, 'human');
  assert.equal(posterior.evilProbability.ai1, 1);
  assert.equal(posterior.evilProbability.ai3, 1);
  assert.equal(posterior.evilProbability.ai2, 0);
});

test('공개 전 투표와 개인별 카드는 확률 계산에 들어가지 않는다', () => {
  const game = { roles: { human: 'LOYAL', ai1: 'MERLIN', ai2: 'LOYAL', ai3: 'ASSASSIN', ai4: 'MINION' },
    phase: 'VOTE', quest: 0, attempt: 1, leader: 'ai1', team: ['ai1', 'ai2'],
    proposals: [{ id: 'proposal-1', quest: 1, attempt: 1, leader: 'ai1',
      team: ['ai1', 'ai2'], status: 'VOTING' }], quests: [], messages: [], votes: {}, cards: {},
    privateCards: [], version: 1 };
  const before = evilPosterior(observe(game), 'human');
  game.votes = { ai1: 'APPROVE', ai3: 'REJECT' };
  game.privateCards = [{ quest: 1, actor: 'ai3', choice: 'FAIL' }];
  assert.deepEqual(evilPosterior(observe(game), 'human'), before);
});
