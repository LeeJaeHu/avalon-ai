import { createGame, apply } from '../lib/game.mjs';
import { decide } from '../lib/ai.mjs';
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY missing');
let game = createGame();
game.leader = 'ai1';
const proposed = await decide(game, { actor:'ai1', type:'PROPOSE' }, key);
game = apply(game, 'ai1', proposed.action);
const speech = await decide(game, { actor:'ai2', type:'CHAT', replyTo:null }, key);
game = apply(game, 'ai2', speech.action);
console.log(JSON.stringify({ proposal: proposed.action.type, teamSize:game.team.length,
  speech:speech.action.type, inputTokens:(proposed.usage?.input ?? 0)+(speech.usage?.input ?? 0),
  outputTokens:(proposed.usage?.output ?? 0)+(speech.usage?.output ?? 0) }));
