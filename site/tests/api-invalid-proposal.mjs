import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8787';
let modelCalls = 0;
let failSecond = false;
const prompts = [];
const mock = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  prompts.push(JSON.parse(body).contents[0].parts[0].text);
  modelCalls++;
  if (failSecond && modelCalls === 2) { response.writeHead(503); response.end(); return; }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ type: 'PROPOSE', team: ['human'] }) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));
});
await new Promise(resolve => mock.listen(9797, '127.0.0.1', resolve));

try {
  let cookie = '';
  let game;
  async function post(type) {
    const response = await fetch(base + '/api/game', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ type, version: game?.version }) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    game = data.game;
    return data;
  }
  for (let i = 0; i < 30; i++) {
    await post('NEW');
    if (game.leader !== 'human') break;
  }
  assert.notEqual(game.leader, 'human');
  assert.equal(Object.hasOwn(game, 'evilBelief'), false);
  await post('START');
  await post('ADVANCE'); // Scripted opening message.
  const result = await post('ADVANCE');
  assert.equal(game.phase, 'TEAM_DISCUSSION');
  assert.equal(game.team.length, game.size);
  assert.match(result.notice, /기본 전략/);
  assert.equal(modelCalls, 2);
  assert.match(prompts[0], /정확히 2명/);
  assert.match(prompts[1], /거부됐습니다/);

  const diagnosticResponse = await fetch(base + '/api/game?diagnostics=1', { headers: { cookie } });
  assert.equal(diagnosticResponse.status, 200);
  const diagnostic = await diagnosticResponse.json();
  assert.equal(diagnostic.format, 'avalon-diagnostics-v1');
  assert.equal(diagnostic.gameId, game.id);
  assert.equal(diagnostic.aiFailures.length, 2);
  assert.ok(diagnostic.aiFailures.every(row => row.error_code === 'INVALID_TEAM'));
  assert.equal(diagnostic.events.at(-1).type, 'PROPOSE');
  assert.equal(JSON.stringify(diagnostic).includes('"roles"'), false);
  assert.equal(JSON.stringify(diagnostic).includes('"messages"'), false);

  modelCalls = 0;
  failSecond = true;
  for (let i = 0; i < 30; i++) {
    await post('NEW');
    if (game.leader !== 'human') break;
  }
  assert.notEqual(game.leader, 'human');
  await post('START');
  await post('ADVANCE');
  const retryFailed = await post('ADVANCE');
  assert.equal(game.phase, 'TEAM_DISCUSSION');
  assert.equal(game.team.length, game.size);
  assert.match(retryFailed.notice, /기본 전략/);
  const failedRetryDiagnostic = await (await fetch(base + '/api/game?diagnostics=1', { headers: { cookie } })).json();
  assert.deepEqual(failedRetryDiagnostic.aiFailures.map(row => row.error_code), ['INVALID_TEAM', 'HTTP_503']);
  console.log(JSON.stringify({ gameId: game.id, teamSize: game.team.length, modelCalls, failures: diagnostic.aiFailures.length }));
} finally {
  await new Promise(resolve => mock.close(resolve));
}
