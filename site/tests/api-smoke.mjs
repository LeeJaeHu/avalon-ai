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
await request('CHAT', { text: '첫 임무 팀은 어떻게 정할까요?' });
for (let i=0;i<80 && game.phase!=='ENDED';i++) {
  if (game.aiPending) await request('ADVANCE');
  else if (game.phase==='PROPOSE') await request('PROPOSE', { team: game.ids.slice(0,game.size) });
  else if (game.phase==='VOTE') await request('VOTE', { choice:'APPROVE' });
  else if (game.phase==='QUEST' && game.team.includes('human')) await request('CARD', { choice:'SUCCESS' });
  else if (game.phase==='ASSASSINATE' && game.role==='ASSASSIN') await request('ASSASSINATE', { target:game.ids.find(id=>id!=='human') });
  else throw new Error('진행 불가: '+JSON.stringify({phase:game.phase,aiPending:game.aiPending}));
}
assert.equal(game.phase,'ENDED');
assert.ok(['GOOD','EVIL'].includes(game.winner));
assert.ok(game.messages.length>=2);
console.log(JSON.stringify({ gameId: game.id, phase: game.phase, winner: game.winner,
  proposals: game.proposals.length, quests: game.quests.length, messages:game.messages.length }));
