// Read-only descriptive audit. No model calls; mixed policies are not an experiment.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const folder = resolve(process.argv[2] ?? 'logs/playtests-2026-10-07');
const evil = role => ['ASSASSIN', 'MINION'].includes(role);
const seen = new Set();
const games = [];
for (const file of readdirSync(folder).filter(f => f.endsWith('.json')).sort()) {
  const log = JSON.parse(readFileSync(join(folder, file), 'utf8'));
  assert.equal(log.format, 'avalon-game-log-v1', file);
  const g = log.game;
  assert(!seen.has(g.id), `Duplicate game: ${g.id}`);
  seen.add(g.id);
  assert.equal(Object.keys(g.roles).length, 5);
  const quests = g.quests.map((q, index) => {
    const cards = g.privateCards.filter(c => c.quest === index + 1);
    assert.equal(cards.length, q.team.length, `${file}: missing quest cards`);
    assert.deepEqual(cards.map(c => c.actor).sort(), [...q.team].sort());
    assert.equal(cards.filter(c => c.choice === 'FAIL').length, q.fails);
    assert.equal(q.result, q.fails > 0 ? 'FAIL' : 'SUCCESS');
    assert(cards.every(c => c.choice === 'SUCCESS' || evil(g.roles[c.actor])));
    return { quest: index + 1, evilMembers: q.team.filter(id => evil(g.roles[id])).length,
      fails: q.fails, result: q.result,
      evilCards: cards.filter(c => evil(g.roles[c.actor])).map(c => ({ actor: c.actor, choice: c.choice })) };
  });
  const assassin = log.events.findLast(e => e.type === 'ASSASSINATE');
  const ally = Object.keys(g.roles).find(id => g.roles[id] === 'MINION');
  const completed = g.phase === 'ENDED' && ['GOOD', 'EVIL'].includes(g.winner);
  const successes = quests.filter(q => q.result === 'SUCCESS').length;
  const assassinationHit = g.assassination ? g.roles[g.assassination] === 'MERLIN' : null;
  if (completed && g.assassination) {
    assert.equal(successes, 3);
    assert.equal(g.winner, assassinationHit ? 'EVIL' : 'GOOD');
  }
  games.push({ file, id: g.id, createdAt: g.createdAt, completed, winner: g.winner,
    humanRole: g.roles.human, policy: g.aiConfig.policyVersion, runtimeChanged: !!g.aiConfig.runtimeChanged,
    model: g.aiConfig.model, mode: g.aiConfig.comparisonMode, successes,
    assassinationHit, allyAssassinationWeight: assassin?.detail?.selection?.probabilities?.[ally] ?? null,
    aiFailures: log.aiFailures.length, messageCount: g.messages.length, quests });
}
const completed = games.filter(g => g.completed);
const quests = completed.flatMap(g => g.quests);
const evilQuests = quests.filter(q => q.evilMembers > 0);
const evilCards = quests.flatMap(q => q.evilCards);
const assassinationGames = completed.filter(g => g.assassinationHit !== null);
console.log(JSON.stringify({ scope: 'Descriptive only; one row per unique game; no causal comparison',
  files: games.length, completed: completed.length, excluded: games.length - completed.length,
  goodWins: completed.filter(g => g.winner === 'GOOD').length,
  evilWins: completed.filter(g => g.winner === 'EVIL').length,
  reachedThreeSuccesses: completed.filter(g => g.successes === 3).length,
  assassinationGames: assassinationGames.length,
  assassinationHits: assassinationGames.filter(g => g.assassinationHit).length,
  evilQuestAppearances: evilQuests.length, evilQuestFailures: evilQuests.filter(q => q.fails > 0).length,
  evilCardDecisions: evilCards.length, evilFailCards: evilCards.filter(c => c.choice === 'FAIL').length,
  doubleEvilQuests: quests.filter(q => q.evilMembers === 2).length,
  doubleEvilAllSuccess: quests.filter(q => q.evilMembers === 2 && q.fails === 0).length,
  doubleEvilDoubleFail: quests.filter(q => q.evilMembers === 2 && q.fails === 2).length,
  runtimeChangedGames: games.filter(g => g.runtimeChanged).length,
  aiFailures: games.reduce((n, g) => n + g.aiFailures, 0), games }, null, 2));
