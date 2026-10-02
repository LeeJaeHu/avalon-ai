import assert from 'node:assert/strict';

const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8787';
let cookie = '';
let game;
async function request(type, extra = {}) {
  const response = await fetch(base + '/api/game', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type, version: game?.version, ...extra }) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  game = data.game;
  return data;
}
await request('NEW');
assert.ok(game.id && game.role && game.aiPending !== undefined);
assert.equal(Object.hasOwn(game, 'aiConfig'), false);
const earlyDiagnostic = await (await fetch(base + '/api/game?diagnostics=1', { headers: { cookie } })).json();
assert.equal(Object.hasOwn(earlyDiagnostic.aiConfig, 'proposalPolicy'), false);
const earlyExport = await fetch(base + '/api/game?export=1', { headers: { cookie } });
assert.equal(earlyExport.status, 409);
assert.equal(game.phase,'ROLE_REVEAL');
assert.equal(game.aiPending,false);
await request('START');
await request('PAUSE');
assert.equal(game.paused,true);
assert.equal(game.aiPending,false);
await request('RESUME');
assert.equal(game.paused,false);
await request('CHAT', { text: '첫 임무 팀은 어떻게 정할까요?' });
for (let i=0;i<180 && game.phase!=='ENDED';i++) {
  if (game.aiPending) await request('ADVANCE');
  else if (game.phase==='PROPOSE') await request('PROPOSE', { team: game.ids.slice(0,game.size) });
  else if (game.phase==='VOTE') await request('VOTE', { choice:'APPROVE' });
  else if (game.phase==='VOTE_RESULT' || game.phase==='QUEST_RESULT') await request('CONTINUE');
  else if (game.phase==='QUEST' && game.team.includes('human')) await request('CARD', { choice:'SUCCESS' });
  else if (game.phase==='ASSASSINATE' && game.role==='ASSASSIN') await request('ASSASSINATE', { target:game.ids.find(id=>id!=='human') });
  else throw new Error('진행 불가: '+JSON.stringify({phase:game.phase,aiPending:game.aiPending}));
}
assert.equal(game.phase,'ENDED');
assert.ok(['GOOD','EVIL'].includes(game.winner));
assert.ok(game.messages.length>=2);
assert.ok(game.messages.every(m => game.ids.includes(m.actor)));
assert.ok(game.messages.some(m => m.actor === 'human'));
assert.ok(game.messages.some(m => /^ai[1-4]$/.test(m.actor)));
const exportResponse = await fetch(base + '/api/game?export=1', { headers: { cookie } });
assert.equal(exportResponse.status, 200);
assert.match(exportResponse.headers.get('content-disposition'), /attachment; filename="avalon-[0-9a-f-]+\.json"/);
const savedLog = await exportResponse.json();
assert.equal(savedLog.format, 'avalon-game-log-v1');
assert.equal(savedLog.game.id, game.id);
assert.equal(savedLog.game.phase, 'ENDED');
assert.ok(savedLog.game.roles && Array.isArray(savedLog.game.privateCards));
assert.equal(savedLog.events.length, game.version + 1);
assert.deepEqual(savedLog.events.map(event => event.version), Array.from({length: game.version + 1}, (_, i) => i));
assert.ok(Array.isArray(savedLog.aiFailures));
assert.ok(['A', 'B'].includes(savedLog.game.aiConfig.proposalPolicy));
const endedDiagnostic = await (await fetch(base + '/api/game?diagnostics=1', { headers: { cookie } })).json();
assert.equal(endedDiagnostic.aiConfig.proposalPolicy, savedLog.game.aiConfig.proposalPolicy);
console.log(JSON.stringify({ gameId: game.id, phase: game.phase, winner: game.winner,
  proposals: game.proposals.length, quests: game.quests.length, messages:game.messages.length }));
