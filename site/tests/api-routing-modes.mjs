// Separate cookie, no START/ADVANCE: validates choices without calling models.
import assert from 'node:assert/strict';
const base = process.env.AVALON_URL ?? 'http://127.0.0.1:8791';
let cookie = '', game;
const auth = process.env.AVALON_SMOKE_BEARER ? {'OAI-Sites-Authorization':`Bearer ${process.env.AVALON_SMOKE_BEARER}`} : {};
async function request(input, selectedCookie = cookie, query = '') {
  const response = await fetch(`${base}/api/game${query}`, {
    method: input ? 'POST' : 'GET', headers: { ...auth, cookie:selectedCookie, ...(input ? {'content-type':'application/json'} : {}) },
    ...(input ? {body:JSON.stringify({...input,version:game?.version})} : {}), signal:AbortSignal.timeout(15000),
  });
  assert.ok(response.headers.get('content-type')?.includes('application/json'), `Expected game API JSON, HTTP ${response.status}`);
  const data=await response.json();
  if (response.ok && input) { cookie=response.headers.getSetCookie().find(value=>value.startsWith('avalon_game='))?.split(';')[0] ?? cookie;game=data.game; }
  return {response,data};
}
const {data:config}=await request();
assert.equal(typeof config.routingReady,'boolean');
let result=await request({type:'NEW',routingMode:'baseline'});
assert.equal(result.response.status,200);assert.equal(game.routingMode,'baseline');
const original=structuredClone(game), originalCookie=cookie;
result=await request({type:'NEW',routingMode:'invalid'});
assert.equal(result.response.status,400);
result=await request();assert.equal(result.data.game.id,original.id);assert.equal(result.data.game.version,original.version);
result=await request({type:'NEW',routingMode:'jev'});
if (config.routingReady) {
  assert.equal(result.response.status,200);assert.equal(game.routingMode,'jev');
  const jevCookie=cookie;
  const archived=await request(null,originalCookie,'?export=1');
  assert.equal(archived.response.status,200);assert.equal(archived.data.game.aiConfig.routingMode,'baseline');
  await request({type:'NEW',routingMode:'baseline'});
  const jevLog=await request(null,jevCookie,'?export=1');
  assert.equal(jevLog.response.status,200);assert.equal(jevLog.data.game.aiConfig.routingMode,'jev');
} else {
  assert.equal(result.response.status,503);
  result=await request();assert.equal(result.data.game.id,original.id);assert.equal(result.data.game.version,original.version);
  await request({type:'NEW',routingMode:'baseline'});
  const archived=await request(null,originalCookie,'?export=1');
  assert.equal(archived.response.status,200);assert.equal(archived.data.game.aiConfig.routingMode,'baseline');
}
console.log(JSON.stringify({check:'routing-mode-api',passed:true,routingReady:config.routingReady,aiMode:config.aiMode,modelCalls:0}));
