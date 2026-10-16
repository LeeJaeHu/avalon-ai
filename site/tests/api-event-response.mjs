// Local Worker + D1 + synthetic Gemini proxy. No provider calls or production writes.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.AVALON_URL??'http://127.0.0.1:5189';
const port=9927;let failChat=true,modelCalls=0,requiredChats=0,game,cookie='',notices=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const input=JSON.parse(raw),prompt=input.contents[0].parts[0].text;
 const request=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);modelCalls++;
 if(request.requiredResponse)requiredChats++;
 const action=request.type==='CHAT'?(failChat?{type:'SILENCE'}:{type:'CHAT',text:'하린과 도윤의 공개 찬반 차이가 있어 다음 구성에서 비교하고 싶어요.',speechAct:'EVIDENCE'}):
 request.type==='PROPOSE'?{type:'PROPOSE',team:['human','ai1','ai2','ai3','ai4'].slice(0,request.requiredTeamSize)}:
 request.type==='VOTE'?{type:'VOTE',choice:'APPROVE'}:request.type==='CARD'?{type:'CARD',choice:'SUCCESS'}:{type:'ASSASSINATE',target:request.actor==='human'?'ai1':'human'};
 res.setHeader('content-type','application/json');res.end(JSON.stringify({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30},candidates:[{content:{parts:[{text:JSON.stringify({...action,thinking:'합성 자기보고'})}]}}]}));
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
async function call(action,query='') {
 const r=await fetch(`${base}/api/game${query}`,{method:action?'POST':'GET',headers:{cookie,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({...action,version:game?.version})}:{})});
 const d=await r.json();assert.equal(r.status,200,`${action?.type??query}: ${JSON.stringify(d)}`);
 cookie=r.headers.getSetCookie().find(v=>v.startsWith('avalon_game='))?.split(';')[0]??cookie;
 if(d.game)game=d.game;if(d.notice)notices.push(d.notice);return d;
}
try {
 await call({type:'NEW',comparisonMode:'gemini'});await call({type:'START'});
 for(let i=0;i<8&&game.phase==='PROPOSE';i++) {
  if(game.aiPending)await call({type:'ADVANCE'});else await call({type:'PROPOSE',team:game.ids.slice(0,game.size)});
 }
 assert.equal(game.phase,'TEAM_DISCUSSION');const before=game.messages.length,callsBefore=modelCalls;
 await call({type:'ADVANCE'});
 assert.equal(modelCalls-callsBefore,1);assert.equal(game.messages.length,before);assert.equal(game.aiPending,false);
 const stoppedVersion=game.version;await call({type:'ADVANCE'});assert.equal(game.version,stoppedVersion);assert.equal(modelCalls-callsBefore,1);
 await call({type:'CHAT',text:'선정 이유를 설명해 주세요.'});const questionCalls=modelCalls;await call({type:'ADVANCE'});
 assert.equal(modelCalls-questionCalls,2);assert.ok(notices.some(n=>n.includes('오류')));assert.ok(game.messages.at(-1).text.includes('응답을 생성하지 못했어요'));
 const fallbackActor=game.messages.at(-1).actor;assert.ok(game.ids.slice(1).includes(fallbackActor));
 failChat=false;
 const seen=new Set(['TEAM_DISCUSSION']);
 for(let i=0;i<70&&!seen.has('QUEST_RESULT');i++) {
  if(game.aiPending)await call({type:'ADVANCE'});
  else if(game.phase==='TEAM_DISCUSSION')await call({type:'START_VOTE'});
  else if(game.phase==='VOTE')await call({type:'VOTE',choice:'APPROVE'});
  else if(game.phase==='VOTE_RESULT')await call({type:'CONTINUE'});
  else if(game.phase==='QUEST')await call({type:'CARD',choice:'SUCCESS'});
  else assert.fail(`Unexpected ${game.phase}`);
  if(['VOTE_RESULT','QUEST_RESULT'].includes(game.phase)&&!seen.has(game.phase)) {
   const count=game.messages.length;assert.ok(game.aiPending);await call({type:'ADVANCE'});
   assert.equal(game.messages.length,count+1);assert.equal(game.messages.at(-1).actor==='human',false);seen.add(game.phase);
  }
 }
 assert.deepEqual([...seen],['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT']);
 const oldCookie=cookie,oldGame=game;
 await call({type:'NEW',comparisonMode:'gemini'});
 cookie=oldCookie;game=oldGame;const log=await call(null,'?export=1');
 const fallback=log.events.find(e=>e.detail?.recoveryReason==='REPLY_GENERATION_FAILURE');
 assert.equal(fallback.actor,fallbackActor);assert.equal(fallback.type,'CHAT');assert.equal(fallback.detail.errorCode,'UNEXPECTED_ACTION');
 assert.ok(log.aiFailures.some(e=>e.actor===fallbackActor));assert.ok(log.events.some(e=>e.type==='SILENCE'&&e.detail?.aiMode==='gemini'));
 assert.ok(log.events.filter(e=>e.detail?.routing).every(e=>!e.detail.routing.requiredResponse||e.detail.routing.requiredResponse==='HUMAN_REPLY_REQUIRED'));
 const result={passed:true,phases:[...seen],fallbackActor,modelCalls,requiredChats,externalProviderCalls:0};
 if(process.env.AVALON_QA_OUTPUT){await mkdir(process.env.AVALON_QA_OUTPUT,{recursive:true});await writeFile(`${process.env.AVALON_QA_OUTPUT}/api-validation.json`,JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result));
} finally {await new Promise(resolve=>server.close(resolve));}
