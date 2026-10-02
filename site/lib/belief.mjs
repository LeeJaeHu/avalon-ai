import { IDS } from './game.mjs';

const EVIL = new Set(['ASSASSIN', 'MINION']);
export const BEHAVIOR_MODEL = Object.freeze({ proposalBias: 1.2, voteBias: -0.4,
  teamVoteBias: 1, finalAttemptBias: 1.2, informedVoteBias: 1, sabotageChance: 0.65 });
const combinations = (items, size) => size === 0 ? [[]] : items.flatMap((item, index) =>
  combinations(items.slice(index + 1), size - 1).map(rest => [item, ...rest]));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const evilOn = (roles, team) => team.filter(id => EVIL.has(roles[id])).length;
const logBinomial = (n, k, chance) => {
  if (k > n) return -Infinity;
  let combinationsCount = 1;
  for (let i = 1; i <= k; i++) combinationsCount *= (n - i + 1) / i;
  return Math.log(combinationsCount) + k * Math.log(chance) + (n - k) * Math.log1p(-chance);
};
const evilCountShares = (possible, team) => Object.fromEntries([0, 1, 2].map(count => [count,
  possible.filter(roles => team.filter(id => EVIL.has(roles[id])).length === count).length / possible.length]));
const assignments = [];
for (const merlin of IDS) for (const assassin of IDS) for (const minion of IDS) {
  if (new Set([merlin, assassin, minion]).size !== 3) continue;
  assignments.push(Object.fromEntries(IDS.map(id => [id,
    id === merlin ? 'MERLIN' : id === assassin ? 'ASSASSIN' : id === minion ? 'MINION' : 'LOYAL'])));
}

export function roleClues(view, actor) {
  const known = [...view.known].sort();
  const possible = assignments.filter(roles => {
    if (roles[actor] !== view.role) return false;
    const candidateKnown = view.role === 'MERLIN'
      ? IDS.filter(id => EVIL.has(roles[id]))
      : EVIL.has(view.role) ? IDS.filter(id => id !== actor && EVIL.has(roles[id])) : [];
    return candidateKnown.sort().join(',') === known.join(',')
      && view.quests.every(quest => quest.team.filter(id => EVIL.has(roles[id])).length >= quest.fails);
  });
  if (!possible.length) throw new Error('역할 후보가 없습니다.');
  const evilCandidateCounts = Object.fromEntries(IDS.map(id => [id, possible.filter(roles => EVIL.has(roles[id])).length]));
  return { possibleAssignments: possible.length,
    evilCandidateCounts,
    evilCandidateShares: Object.fromEntries(IDS.map(id => [id, evilCandidateCounts[id] / possible.length])),
    questTeamEvilShares: view.quests.map(quest => ({ questId: quest.id, team: quest.team,
      fails: quest.fails, evilMembers: evilCountShares(possible, quest.team) })),
    currentTeamEvilShares: view.team ? evilCountShares(possible, view.team) : null };
}

// ponytail: 60 assignments are small enough to enumerate; fit the behavior parameters when labeled games exist.
export function weightedRoleAssignments(view, actor, model = BEHAVIOR_MODEL) {
  const known = [...view.known].sort().join(',');
  const choices = assignments.filter(roles => roles[actor] === view.role &&
    (view.role === 'MERLIN' ? IDS.filter(id => EVIL.has(roles[id]))
      : EVIL.has(view.role) ? IDS.filter(id => id !== actor && EVIL.has(roles[id])) : [])
      .sort().join(',') === known);
  const scores = choices.map(roles => {
    let score = 0;
    for (const proposal of view.proposals ?? []) {
      const leaderRole = roles[proposal.leader];
      const bias = leaderRole === 'MERLIN' ? -model.proposalBias
        : EVIL.has(leaderRole) ? model.proposalBias : 0;
      const teams = combinations(IDS, proposal.team.length);
      const weights = teams.map(team => Math.exp(bias * evilOn(roles, team)));
      const selected = teams.findIndex(team => team.every(id => proposal.team.includes(id)));
      score += Math.log(weights[selected] / weights.reduce((a, b) => a + b, 0));
      for (const vote of proposal.votes ?? []) {
        const voterRole = roles[vote.actor];
        const informed = voterRole === 'MERLIN' ? -1 : EVIL.has(voterRole) ? 1 : 0;
        const approve = sigmoid(model.voteBias
          + model.teamVoteBias * Number(proposal.team.includes(vote.actor))
          + model.finalAttemptBias * Number(proposal.attempt === 5)
          + model.informedVoteBias * informed * evilOn(roles, proposal.team));
        score += Math.log(vote.choice === 'APPROVE' ? approve : 1 - approve);
      }
    }
    for (const quest of view.quests ?? []) score += logBinomial(
      evilOn(roles, quest.team), quest.fails, model.sabotageChance);
    return score;
  });
  const peak = Math.max(...scores);
  if (peak === -Infinity) throw new Error('관찰과 양립하는 역할 배정이 없습니다.');
  const weights = scores.map(score => Math.exp(score - peak));
  const total = weights.reduce((a, b) => a + b, 0);
  return choices.map((roles, index) => ({ roles, probability: weights[index] / total }))
    .filter(item => item.probability > 0);
}

export function evilPosterior(view, actor, model = BEHAVIOR_MODEL) {
  const posterior = weightedRoleAssignments(view, actor, model);
  const evilProbability = Object.fromEntries(IDS.map(id => [id,
    posterior.reduce((sum, item) => sum + (EVIL.has(item.roles[id]) ? item.probability : 0), 0)]));
  return { evilProbability, possibleAssignments: posterior.length,
    model: 'illustrative-v1' };
}
