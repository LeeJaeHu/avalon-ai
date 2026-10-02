import assert from 'node:assert/strict';
const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8799';
let cookie = ''; let game; let recoveries = 0;
async function post(type, extra = {}) {
  const response = await fetch(base + '/api/game', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ type, version: game?.version, ...extra }) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  game = data.game;
  if (data.notice?.includes('기본 규칙')) recoveries++;
}
await post('NEW'); await post('START'); await post('ADVANCE');
for (let step = 0; step < 160 && game.phase !== 'ENDED'; step++) {
  if (game.aiPending) await post('ADVANCE');
  else if (game.phase === 'PROPOSE') await post('PROPOSE', { team: game.ids.slice(0, game.size) });
  else if (game.phase === 'VOTE') await post('VOTE', { choice: 'APPROVE' });
  else if (['VOTE_RESULT', 'QUEST_RESULT'].includes(game.phase)) await post('CONTINUE');
  else if (game.phase === 'QUEST') await post('CARD', { choice: 'SUCCESS' });
  else if (game.phase === 'ASSASSINATE') await post('ASSASSINATE', { target: 'ai1' });
  else assert.fail(`진행 불가: ${game.phase}`);
}
assert.equal(game.phase, 'ENDED'); assert.ok(recoveries > 0);
const log = await (await fetch(base + '/api/game?export=1', { headers: { cookie } })).json();
assert.ok(log.aiFailures.some(failure => failure.error_code === 'HTTP_500'));
assert.ok(log.events.some(event => event.type === 'VOTE' && event.detail.aiMode === 'fallback'));
assert.ok(log.events.filter(event => event.detail.aiMode === 'fallback').every(event => event.detail.reason === 'MODEL_FAILURE'));
console.log(JSON.stringify({ gameId: game.id, phase: game.phase, recoveries, failureRecords: log.aiFailures.length }));
