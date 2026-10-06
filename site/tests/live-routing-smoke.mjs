// Bounded production connection check, separate synthetic games. Not a quality eval.
import assert from 'node:assert/strict';
const input = await new Promise(resolve => {
  let value='';const terminal=process.stdin.isTTY;
  const done=()=>{process.stdin.removeListener('data',read);if(terminal)process.stdin.setRawMode(false);process.stdin.pause();resolve(JSON.parse(value));};
  const read=chunk=>{value+=chunk;if(value.includes('\n')||value.includes('\r'))done();};
  if(terminal)process.stdin.setRawMode(true);
  process.stderr.write('Ready for connection-check JSON (input is hidden).\n');
  process.stdin.setEncoding('utf8');process.stdin.on('data',read);process.stdin.resume();
});
process.env.AVALON_URL=input.base;process.env.AVALON_SMOKE_BEARER=input.bearer;
await import('./api-routing-modes.mjs');
assert.equal(new URL(input.base).protocol,'https:');
const summaries=[];
for (const routingMode of ['baseline','jev']) {
  let game, cookie='';
  async function call(action, oldCookie=cookie, query='') {
    const response=await fetch(`${input.base}/api/game${query}`,{
      method:action?'POST':'GET',headers:{'OAI-Sites-Authorization':`Bearer ${input.bearer}`,cookie:oldCookie,...(action?{'content-type':'application/json'}:{})},
      ...(action?{body:JSON.stringify({...action,version:game?.version})}:{}),signal:AbortSignal.timeout(60000),
    });
    assert.equal(response.status,200,`HTTP ${response.status} at ${action?.type??query}`);
    const data=await response.json();
    if(action){game=data.game;cookie=response.headers.getSetCookie().find(value=>value.startsWith('avalon_game='))?.split(';')[0]??cookie;}
    return data;
  }
  await call({type:'NEW',routingMode});
  await call({type:'START'});
  // Opening uses the existing scripted rule. No Gemini or JEV call.
  await call({type:'ADVANCE'});
  await call({type:'CHAT',text:'첫 원정의 두 명을 고를 때 어떤 근거를 확인해야 하나요?'});
  await call({type:'ADVANCE'}); // One public discussion decision per mode; existing Gemini retries may apply.
  await call({type:'PAUSE'});
  const oldCookie=cookie;
  await call({type:'NEW',routingMode:'baseline'});
  const log=await call(null,oldCookie,'?export=1');
  const event=log.events.findLast(e=>e.detail.routing);
  assert.ok(event,'Routing event must persist');
  assert.equal(event.detail.routing.mode,routingMode);
  if(routingMode==='jev')assert.equal(event.detail.routing.status,'OK');
  const modelEvents=log.events.filter(e=>e.detail.aiMode==='gemini');
  if(event.detail.routing.selectedActor!=='WAIT')assert.ok(modelEvents.length>0,'Gemini chat must be published');
  assert.ok(log.usageSummary,'Usage summary must persist');
  assert.ok(log.modelUsage.length>0,'Every provider attempt must persist');
  assert.equal(log.usageSummary.unknownCalls,0,'Provider usage must be returned');
  if(routingMode==='jev'){assert.equal(log.game.aiConfig.conversationVersion,1);assert.ok(event.detail.routing.progress);}
  summaries.push({usageSummary:log.usageSummary,progress:event.detail.routing.progress,routingMode,gameId:log.game.id,status:event.detail.routing.status,selectedActor:event.detail.routing.selectedActor,
    jevInputTokens:event.detail.routing.inputTokens,jevCostUsd:event.detail.routing.costUsd,
    geminiPublished:modelEvents.length,geminiInputTokens:modelEvents.reduce((n,e)=>n+(e.detail.inputTokens??0),0),
    geminiOutputTokens:modelEvents.reduce((n,e)=>n+(e.detail.outputTokens??0),0),geminiRetries:modelEvents.reduce((n,e)=>n+(e.detail.modelRetries??0),0)});
}
console.log(JSON.stringify({check:'live-routing-connection',passed:true,qualityEvaluated:false,summaries}));
