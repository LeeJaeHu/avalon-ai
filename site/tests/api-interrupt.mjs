import assert from 'node:assert/strict';

const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8787';
let cookie = '';
let game;
async function post(type, extra = {}, version = game?.version) {
  const response = await fetch(base + '/api/game', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type, version, ...extra }) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  if (data.game) game = data.game;
  return { status: response.status, data };
}
async function ok(type, extra) {
  const result = await post(type, extra);
  assert.equal(result.status, 200, JSON.stringify(result.data));
}

await ok('NEW');
await ok('START');
assert.equal(game.aiPending, true);
await ok('CHAT', { text: 'AI 발언 전에 보내는 말' });
assert.equal(game.messages.at(-1).text, 'AI 발언 전에 보내는 말');
assert.equal(game.messages.at(-1).speechAct, 'OTHER');
await ok('ADVANCE');
for (let i = 0; i < 8 && game.phase !== 'VOTE'; i++) {
  if (game.aiPending) await ok('ADVANCE');
  else if (game.phase === 'TEAM_DISCUSSION') await ok('START_VOTE');
  else if (game.phase === 'PROPOSE') await ok('PROPOSE', { team: game.ids.slice(0, game.size) });
  else throw new Error(`투표 단계에 도달하지 못함: ${game.phase}`);
}
assert.equal(game.phase, 'VOTE');
assert.equal(game.aiPending, true);
const oldVersion = game.version;
await ok('VOTE', { choice: 'APPROVE' });
assert.equal(game.voted, true);
const stale = await post('ADVANCE', {}, oldVersion);
assert.equal(stale.status, 409);
assert.equal(stale.data.game.version, game.version);
await ok('ADVANCE');
assert.equal(game.voted, true);
console.log(JSON.stringify({ gameId: game.id, version: game.version, humanVoteSaved: game.voted }));
