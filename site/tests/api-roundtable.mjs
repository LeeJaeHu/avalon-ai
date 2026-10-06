import assert from 'node:assert/strict';
const base=process.env.AVALON_URL??'http://127.0.0.1:5173';
let cookie='',game;
async function post(type,extra={},version=game?.version){
  const r=await fetch(base+'/api/game',{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify({type,version,...extra})});
  const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
  const d=await r.json();if(d.game)game=d.game;
  return {status:r.status,data:d};
}
async function ok(type,extra){const r=await post(type,extra);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
assert.equal((await (await fetch(base+'/api/game')).json()).aiMode,'practice','이 검사는 외부 모델 없이 로컬 연습 환경에서 실행합니다.');
await ok('NEW');await ok('START');
for(let i=0;i<10&&game.phase!=='TEAM_DISCUSSION';i++){
  if(game.aiPending)await ok('ADVANCE');
  else await ok('PROPOSE',{team:game.ids.slice(0,game.size)});
}
assert.equal(game.phase,'TEAM_DISCUSSION');
assert.equal((await post('VOTE',{choice:'APPROVE'})).status,400);
await ok('CHAT',{text:'이 팀을 고른 근거를 설명해 주세요.'});
await ok('ADVANCE');
const proposalId=game.currentProposalId,attempt=game.attempt;
if(game.leader==='human')await ok('PROPOSE',{team:game.ids.slice(-game.size)});
else{
  await ok('REQUEST_REVISION');
  assert.equal((await post('START_VOTE')).status,400);
  for(let i=0;i<5&&game.revisionRequested;i++)await ok('ADVANCE');
  assert.equal(game.revisionRequested,false);
}
assert.equal(game.currentProposalId,proposalId);assert.equal(game.attempt,attempt);
await ok('PAUSE');assert.equal(game.aiPending,false);
assert.equal((await post('START_VOTE')).status,400);
await ok('RESUME');
const oldVersion=game.version;
await ok('START_VOTE');assert.equal(game.phase,'VOTE');
assert.equal((await post('START_VOTE',{},oldVersion)).status,409);
assert.equal((await post('PROPOSE',{team:game.ids.slice(0,game.size)})).status,400);
await ok('VOTE',{choice:'APPROVE'});
assert.equal(game.publicEvents.some(e=>e.kind==='VOTE_RESULT'),false);
for(let i=0;i<10&&game.phase!=='VOTE_RESULT';i++)await ok('ADVANCE');
assert.equal(game.phase,'VOTE_RESULT');
assert.equal(game.publicEvents.at(-1).kind,'VOTE_RESULT');
const reloaded=await (await fetch(base+'/api/game',{headers:{cookie}})).json();
assert.deepEqual(reloaded.game.publicEvents,game.publicEvents);
assert.equal(game.publicEvents.some(e=>e.kind==='TEAM'),true);
assert.equal(JSON.stringify(game.publicEvents).includes('roles'),false);
console.log(JSON.stringify({gameId:game.id,phase:game.phase,proposalId,attempt,publicEvents:game.publicEvents.length,reloadVerified:true}));
