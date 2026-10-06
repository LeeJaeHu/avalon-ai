// NEW/GET only; never START or ADVANCE, no model calls.
import assert from 'node:assert/strict';
const base=process.env.AVALON_URL??'http://127.0.0.1:5190';let cookie='',game;
async function request(body,selectedCookie=cookie,query=''){
  const response=await fetch(`${base}/api/game${query}`,{method:body?'POST':'GET',headers:{cookie:selectedCookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,version:game?.version})}:{})});
  const data=await response.json();if(response.ok&&body){game=data.game;cookie=response.headers.getSetCookie().find(x=>x.startsWith('avalon_game='))?.split(';')[0]??cookie;}
  return {status:response.status,data};
}
const config=await request();assert.equal(config.status,200);
let result=await request({type:'NEW',comparisonMode:'gemini',routingMode:'jev',actionMode:'jev'});
assert.equal(result.status,200);assert.equal(game.actionMode,'gemini');assert.equal(game.routingMode,'baseline');assert.equal(game.comparisonMode,'gemini');
const first=structuredClone(game),firstCookie=cookie;
result=await request({type:'NEW',comparisonMode:'invalid'});assert.equal(result.status,400);assert.equal((await request()).data.game.id,first.id);
result=await request({type:'NEW',comparisonMode:'hybrid',routingMode:'baseline',actionMode:'gemini'});
if(config.data.routingReady){assert.equal(result.status,200);assert.equal(game.actionMode,'jev');assert.equal(game.routingMode,'jev');}
else{assert.equal(result.status,503);assert.equal((await request()).data.game.id,first.id);}
await request({type:'NEW',comparisonMode:'gemini'});
const archived=await request(null,firstCookie,'?export=1');assert.equal(archived.status,200);assert.equal(archived.data.game.aiConfig.comparisonVersion,'gemini-jev-v1');assert.equal(archived.data.game.aiConfig.comparisonMode,'gemini');
assert.equal(archived.data.game.aiConfig.proposalPolicy,'A');assert.equal(archived.data.game.endReason,'RESTARTED');
console.log(JSON.stringify({passed:true,routingReady:config.data.routingReady,modelCalls:0}));
