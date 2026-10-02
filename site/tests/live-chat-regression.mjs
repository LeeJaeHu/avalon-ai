import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, nextAiAction } from '../lib/ai.mjs';

// Explicitly approved evaluation only. Never prints prompts, thinking, roles, or credentials.
const saved = JSON.parse(readFileSync(process.env.AVALON_EVAL_LOG, 'utf8')).game;
const credential = { url: process.env.AVALON_EVAL_URL, token: process.env.AVALON_EVAL_TOKEN };
const originalFetch = globalThis.fetch;
let calls = 0;
const limit = Number(process.env.AVALON_EVAL_LIMIT ?? 3);
assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 3);
globalThis.fetch = (...args) => {
  if (++calls > limit) throw Object.assign(new Error('Evaluation budget exhausted'), { code: 'EVAL_BUDGET' });
  return originalFetch(...args);
};
const results = [];
const snapshot = count => {
  const game = structuredClone(saved);
  game.phase = 'VOTE_RESULT'; game.winner = null; game.paused = false;
  game.messages = game.messages.slice(0, count);
  game.pendingSpeech = game.messages.at(-1).id; game.pendingDiscussion = game.pendingSpeech;
  game.quests = game.quests.slice(0, count === 7 ? 0 : 2);
  game.proposals = game.proposals.slice(0, count === 7 ? 1 : 2);
  game.quest = count === 7 ? 0 : 2; game.cards = {}; game.privateCards = [];
  return game;
};
for (const item of [
  { name: 'implicit-question', game: snapshot(7), actor: 'ai2' },
  { name: 'self-identity', game: snapshot(11), actor: 'ai1' },
  { name: 'vote-json', game: snapshot(11), request: { actor: 'ai1', type: 'VOTE' }, actor: 'ai1' },
].slice(0, limit)) {
  try {
    const decision = await decide(item.game, item.request ?? nextAiAction(item.game), credential);
    assert.equal(decision.actor, item.actor);
    assert.ok(!Object.hasOwn(decision.action, 'thinking'));
    assert.equal(decision.action.type, item.request ? 'VOTE' : 'CHAT');
    results.push({ case: item.name, ok: true, actor: decision.actor, type: decision.action.type, usage: decision.usage });
  } catch (error) { results.push({ case: item.name, ok: false, code: error.code ?? 'ASSERTION' }); }
}
console.log(JSON.stringify({ calls: Math.min(calls, limit), results }));
if (results.some(result => !result.ok)) process.exitCode = 1;
