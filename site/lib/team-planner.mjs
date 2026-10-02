import { IDS } from './game.mjs';
import { BEHAVIOR_MODEL, weightedRoleAssignments } from './belief.mjs';

const EVIL = new Set(['ASSASSIN', 'MINION']);
const sigmoid = value => 1 / (1 + Math.exp(-value));
const logit = chance => Math.log(chance / (1 - chance));
const teamsOf = (ids, size) => size === 0 ? [[]] : ids.flatMap((id, index) =>
  teamsOf(ids.slice(index + 1), size - 1).map(rest => [id, ...rest]));
const approvalChance = chances => {
  let counts = [1, 0, 0, 0, 0, 0];
  for (const chance of chances) {
    const next = [0, 0, 0, 0, 0, 0];
    for (let count = 0; count < 5; count++) {
      next[count] += counts[count] * (1 - chance);
      next[count + 1] += counts[count] * chance;
    }
    counts = next;
  }
  return counts.slice(3).reduce((sum, chance) => sum + chance, 0);
};
const pivotalChance = chances => {
  let counts = [1, 0, 0, 0, 0];
  for (const chance of chances) {
    const next = [0, 0, 0, 0, 0];
    for (let count = 0; count < 4; count++) {
      next[count] += counts[count] * (1 - chance);
      next[count + 1] += counts[count] * chance;
    }
    counts = next;
  }
  return counts[2];
};

// Three damped response rounds are a bounded opponent model, not an equilibrium solver.
export function planTeam(view, actor, { rounds = 3, model = BEHAVIOR_MODEL } = {}) {
  if (view.role !== 'LOYAL' || view.leader !== actor || view.phase !== 'PROPOSE')
    throw new Error('충신 리더의 팀 제안 단계가 아닙니다.');
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 10) throw new Error('반복 횟수가 잘못됐습니다.');
  const posterior = weightedRoleAssignments(view, actor, model);
  const candidates = teamsOf(IDS, view.size);
  const scores = candidates.map(team => {
    const publicSuccess = posterior.reduce((sum, { roles, probability }) => {
      const evilCount = team.filter(id => EVIL.has(roles[id])).length;
      return sum + probability * (1 - model.sabotageChance) ** evilCount;
    }, 0);
    let score = 0;
    let approved = 0;
    let questSuccess = 0;
    for (const { roles, probability } of posterior) {
      const evilCount = team.filter(id => EVIL.has(roles[id])).length;
      const success = (1 - model.sabotageChance) ** evilCount;
      const priors = IDS.map(id => {
        const informed = roles[id] === 'MERLIN' ? -1 : EVIL.has(roles[id]) ? 1 : 0;
        return sigmoid(model.voteBias + model.teamVoteBias * Number(team.includes(id))
          + model.finalAttemptBias * Number(view.attempt === 5)
          + model.informedVoteBias * informed * evilCount);
      });
      let votes = priors;
      for (let round = 0; round < rounds; round++) {
        votes = IDS.map((id, index) => {
          const perceivedSuccess = roles[id] === 'LOYAL' ? publicSuccess : success;
          const good = !EVIL.has(roles[id]);
          const approveValue = (good ? 1 : -1) * (2 * perceivedSuccess - 1);
          const rejectValue = view.attempt === 5 ? (good ? -1 : 1) : 0;
          const pivotal = pivotalChance(votes.filter((_, other) => other !== index));
          const response = sigmoid(logit(priors[index]) + 2 * pivotal * (approveValue - rejectValue));
          return (votes[index] + response) / 2;
        });
      }
      const pass = approvalChance(votes);
      const rejectValue = view.attempt === 5 ? -1 : -0.15;
      score += probability * (pass * (2 * success - 1) + (1 - pass) * rejectValue);
      approved += probability * pass;
      questSuccess += probability * pass * success;
    }
    return { team, score, approvalChance: approved, questSuccessChance: questSuccess };
  }).sort((a, b) => b.score - a.score || a.team.join(',').localeCompare(b.team.join(',')));
  if (!scores.length || !Number.isFinite(scores[0].score)) throw new Error('팀 점수를 계산하지 못했습니다.');
  return { team: scores[0].team, scores, rounds, model: 'bounded-response-v1' };
}
