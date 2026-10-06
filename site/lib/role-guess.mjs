export const ROLE_GUESS_VERSION = 'pre-assassination-v1';
const roleCounts = { MERLIN: 1, LOYAL: 2, ASSASSIN: 1, MINION: 1 };
export function roleGuessPending(game) {
  if (!game?.aiConfig?.roleGuessVersion || game.phase !== 'QUEST_RESULT' || game.roleGuess) return false;
  const successes = game.quests.filter(q => q.result === 'SUCCESS').length;
  return successes === 3 || game.quests.length - successes === 3;
}
export function submitRoleGuess(game, actor, guesses) {
  if (actor !== 'human' || !roleGuessPending(game)) throw new Error('지금 역할 추측을 제출할 수 없습니다.');
  const targets = Object.keys(game.roles).filter(id => id !== 'human');
  if (!guesses || typeof guesses !== 'object' || Array.isArray(guesses) || Object.keys(guesses).length !== targets.length
    || targets.some(id => !Object.hasOwn(guesses, id) || !Object.hasOwn(roleCounts, guesses[id]))) throw new Error('모든 AI 플레이어의 역할을 선택해 주세요.');
  const counts = { MERLIN: 0, LOYAL: 0, ASSASSIN: 0, MINION: 0 };
  counts[game.roles.human]++;
  for (const id of targets) counts[guesses[id]]++;
  if (Object.keys(counts).some(role => counts[role] !== roleCounts[role])) throw new Error('멀린 1명, 충신 2명, 암살자 1명, 악의 하수인 1명으로 맞춰 주세요. 본인 역할도 포함됩니다.');
  const answers = Object.fromEntries(targets.map(id => [id, guesses[id]]));
  const matches = Object.fromEntries(targets.map(id => [id, answers[id] === game.roles[id]]));
  return { metricVersion: ROLE_GUESS_VERSION, guesses: answers, matches, correct: Object.values(matches).filter(Boolean).length, total: targets.length,
    submittedAt: new Date().toISOString(), stateVersion: game.version, questCount: game.quests.length, humanRole: game.roles.human,
    knownAtStart: game.roles.human === 'MERLIN' ? targets.filter(id => ['ASSASSIN', 'MINION'].includes(game.roles[id]))
      : ['ASSASSIN', 'MINION'].includes(game.roles.human) ? targets.filter(id => ['ASSASSIN', 'MINION'].includes(game.roles[id])) : [], aiConfig: structuredClone(game.aiConfig) };
}
