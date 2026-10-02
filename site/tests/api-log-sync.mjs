import assert from 'node:assert/strict';

const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8799';
const token = process.env.AVALON_LOG_TOKEN ?? 'local-test-sync';
const headers = { 'x-avalon-log-token': token };
assert.equal((await fetch(base + '/api/logs')).status, 401);
const create = async (cookie, version) => {
  const response = await fetch(base + '/api/game', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'NEW', version }) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], game: (await response.json()).game };
};
const first = await create();
assert.equal((await fetch(base + '/api/logs?id=' + first.game.id, { headers })).status, 404);
const second = await create(first.cookie, first.game.version);
const response = await fetch(base + '/api/logs?id=' + first.game.id, { headers });
assert.equal(response.status, 200);
const log = await response.json();
assert.equal(log.game.phase, 'ENDED');
assert.equal(log.game.endReason, 'RESTARTED');
assert.equal(log.game.winner, null);
assert.equal(log.game.version, first.game.version + 1);
assert.equal(log.events.at(-1).type, 'GAME_RESTARTED');
assert.ok(['A', 'B'].includes(log.game.aiConfig.proposalPolicy));
assert.ok(log.game.roles && log.game.endedAt);
assert.equal((await fetch(base + '/api/logs?id=' + second.game.id, { headers })).status, 404);
assert.equal((await fetch(base + '/api/logs?id=invalid', { headers })).status, 400);
let after = '', ids = [];
do {
  const page = await (await fetch(base + '/api/logs' + (after ? '?after=' + after : ''), { headers })).json();
  ids.push(...page.games.map(game => game.id));
  after = page.next;
} while (after);
assert.ok(ids.includes(first.game.id));
assert.ok(!ids.includes(second.game.id));
console.log(JSON.stringify({ restartArchived: true, activeGameExcluded: true, authenticationChecked: true }));
