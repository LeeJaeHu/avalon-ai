// Separate synthetic game, one team discussion only. No manual progress actions.
import assert from 'node:assert/strict';
const input=await new Promise(resolve=>{
 let value='';const terminal=process.stdin.isTTY;
 const read=chunk=>{value+=chunk;if(!/[\n\r]/.test(value))return;process.stdin.removeListener('data',read);if(terminal)process.stdin.setRawMode(false);process.stdin.pause();resolve(JSON.parse(value));};
 if(terminal)process.stdin.setRawMode(true);process.stderr.write('Ready for connection-check JSON (input is hidden).\n');process.stdin.setEncoding('utf8');process.stdin.on('data',read);process.stdin.resume();
});
let game,cookie='',requests=0;
async function call(action,oldCookie=cookie,query=''){
 const response=await fetch(`${input.base}/api/game${query}`,{method:action?'POST':'GET',headers:{'OAI-Sites-Authorization':`Bearer ${input.bearer}`,cookie:oldCookie,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({...action,version:game?.version})}:{}),signal:AbortSignal.timeout(60000)});
 assert.equal(response.status,200,`HTTP ${response.status} at ${action?.type??query}`);const data=await response.json();
 if(action){requests++;game=data.game;cookie=response.headers.getSetCookie().find(v=>v.startsWith('avalon_game='))?.split(';')[0]??cookie;}return data;
}
await call({type:'NEW',routingMode:'jev'});await call({type:'START'});
for(let i=0;i<5&&game.phase!=='TEAM_DISCUSSION';i++){
 if(game.aiPending)await call({type:'ADVANCE'});
 else if(game.phase==='PROPOSE')await call({type:'PROPOSE',team:game.ids.slice(0,game.size)});
 else assert.fail(`Unexpected setup ${game.phase}`);
}
assert.equal(game.phase,'TEAM_DISCUSSION');
await call({type:'CHAT',text:'현재 팀의 선정 이유를 설명해 주세요.'});
const messageId=game.messages.at(-1).id;
for(let i=0;i<20&&game.phase==='TEAM_DISCUSSION';i++){
 if(!game.aiPending&&game.idleDueAt){const delay=Math.max(0,game.idleDueAt-Date.now())+100;assert.ok(delay<25000);await new Promise(r=>setTimeout(r,delay));}
 assert.ok(game.aiPending||game.idleDueAt,'Automatic scheduling must remain available');
 await call({type:'ADVANCE'});
}
assert.equal(game.phase,'VOTE','Must reach vote without START_VOTE or CONTINUE');
assert.ok(game.messages.some(m=>m.actor!=='human'&&m.replyTo===messageId),'Human message must receive a visible answer');
await call({type:'PAUSE'});const oldCookie=cookie;await call({type:'NEW',routingMode:'baseline'});const log=await call(null,oldCookie,'?export=1');
assert.ok(log.events.some(e=>e.type==='ANNOUNCE_VOTE'));assert.ok(log.events.some(e=>e.type==='START_VOTE'&&e.actor==='system'));
console.log(JSON.stringify({check:'live-conversation-progress',passed:true,gameId:log.game.id,phase:log.game.phase,requests,qualityEvaluated:false,recoveries:log.events.filter(e=>e.detail.recoveryReason).map(e=>({type:e.type,reason:e.detail.recoveryReason})),usageSummary:log.usageSummary}));
