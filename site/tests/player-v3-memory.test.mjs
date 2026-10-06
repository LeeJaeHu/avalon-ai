import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {TEMPLATE,PROMPT_VERSION,buildPromptV3} from '../lib/prompts/v3.mjs';
import {createGame,apply,observe,observeModerator} from '../lib/game.mjs';
import {decide} from '../lib/ai.mjs';import {rememberThinking,thinkingDetail} from '../lib/thinking-memory.mjs';
import {routingPayload} from '../lib/discussion-routing.mjs';import {gameLog} from '../lib/game-log.mjs';
const response=(action)=>Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,totalTokenCount:130},candidates:[{content:{parts:[{text:JSON.stringify(action)}]}}]});
function setup(){let g=createGame(()=>.5);g.leader='human';g=apply(g,'human',{type:'START'});g=apply(g,'human',{type:'PROPOSE',team:['human','ai1']});for(let i=1;i<=25;i++)g=apply(g,i%2?'ai1':'ai2',{type:'CHAT',text:`공개 발언 ${i}`,speechAct:'ANSWER'});return g;}

test('사용자 V3 원문을 그대로 반영하고 필수 자리표시자·성향을 연결한다',()=>{
 assert.equal(TEMPLATE,readFileSync(new URL('../lib/prompts/v3.txt',import.meta.url),'utf8'));
 assert.equal(PROMPT_VERSION,'V3-thinking-memory-v1');const g=setup();
 const prompt=buildPromptV3({request:{type:'CHAT',actor:'ai1'},view:observe(g,'ai1'),publicState:observeModerator(g),personalInfo:{previousThinking:null}});
 assert.ok(prompt.includes('나의 목표, 인식한 현재 상황과 입장'));assert.ok(!prompt.includes('[공개 게임 상태 JSON]'));assert.ok(prompt.includes('"name":"하린"'));
});

test('최근 채팅 20개·본인 직전 생각만 입력하고 공개/JEV로는 유출하지 않는다',async()=>{
 const original=globalThis.fetch;const attempts=[];let g=setup();g.privateThinking={ai1:{text:'SELF_PRIVATE_MARKER'},ai2:{text:'OTHER_PRIVATE_MARKER'}};
 try{globalThis.fetch=async(_url,options)=>{
  const payload=JSON.parse(options.body),prompt=payload.contents[0].parts[0].text;
  assert.ok(prompt.includes('SELF_PRIVATE_MARKER'));assert.ok(!prompt.includes('OTHER_PRIVATE_MARKER'));
  const publicState=JSON.parse(prompt.split('공개 정보는 다음과 같습니다.')[1].trim().split('\n')[0]);
  assert.equal(publicState.messages.length,20);assert.equal(publicState.messages[0].text,'공개 발언 6');assert.equal(publicState.messages.at(-1).text,'공개 발언 25');assert.ok(payload.generationConfig.responseSchema.required.includes('thinking'));
  return response({type:'CHAT',text:'선정 이유를 확인하겠습니다.',speechAct:'ANSWER',thinking:'NEW_SELF_MARKER'});
 };
 const decision=await decide(g,{actor:'ai1',type:'CHAT'},'mock',null,{onUsage:r=>attempts.push(r)});
 assert.equal(decision.thinking,'NEW_SELF_MARKER');assert.equal(attempts.at(-1).thinking,'NEW_SELF_MARKER');assert.equal(attempts.at(-1).actor,'ai1');
 const next=apply(g,decision.actor,decision.action);rememberThinking(next,decision);assert.equal(next.privateThinking.ai1.text,'NEW_SELF_MARKER');assert.equal(next.privateThinking.ai2.text,'OTHER_PRIVATE_MARKER');
 for(const publicView of [observe(next),observe(next,'ai2'),observeModerator(next),routingPayload(next,{actor:'ai1',type:'DISCUSS'})])assert.ok(!JSON.stringify(publicView).includes('PRIVATE_MARKER')&&!JSON.stringify(publicView).includes('NEW_SELF_MARKER'));
 const stale={...next,version:next.version+1};rememberThinking(stale,{...decision,thinking:'STALE_MARKER'});assert.equal(stale.privateThinking.ai1.text,'NEW_SELF_MARKER');
 globalThis.fetch=async(_u,o)=>{const p=JSON.parse(o.body).contents[0].parts[0].text;assert.ok(p.includes('NEW_SELF_MARKER'));assert.ok(!p.includes('SELF_PRIVATE_MARKER'));return response({type:'CHAT',text:'근거를 더 확인하겠습니다.',speechAct:'ANSWER',thinking:'NEXT_SELF_MARKER'});};
 await decide(next,{actor:'ai1',type:'CHAT'},'mock');
 }finally{globalThis.fetch=original;}
});

test('재시도 생각은 사용량 로그에 남기되 채택된 생각만 기억하고 누락/대체는 보존한다',async()=>{
 const original=globalThis.fetch;let calls=0;const attempts=[];const g=setup();
 try{globalThis.fetch=async()=>response(++calls===1?{type:'CARD',choice:'FAIL',thinking:'RETRY_MARKER'}:{type:'CHAT',text:'현재 팀을 검토하겠습니다.',speechAct:'ANSWER',thinking:'ACCEPTED_MARKER'});
 const d=await decide(g,{actor:'ai1',type:'CHAT'},'mock',null,{onUsage:r=>attempts.push(r)});assert.equal(calls,2);assert.deepEqual(attempts.filter(r=>r.thinking).map(r=>r.thinking),['RETRY_MARKER','ACCEPTED_MARKER']);
 const next=apply(g,d.actor,d.action);rememberThinking(next,d);assert.equal(next.privateThinking.ai1.text,'ACCEPTED_MARKER');
 for(const bad of [{...d,mode:'fallback',thinking:'BAD'},{...d,thinking:null},{...d,thinkingOwner:'human'}])rememberThinking(next,bad);
 assert.equal(next.privateThinking.ai1.text,'ACCEPTED_MARKER');
 const detail=thinkingDetail(d);assert.equal(detail.thinkingOwner,'ai1');assert.equal(detail.thinking,'ACCEPTED_MARKER');
 const db={prepare(sql){return{bind(){return{async all(){return{results:sql.includes('FROM events')?[{detail:JSON.stringify(detail)}]:sql.includes('FROM model_usage')?[{detail:JSON.stringify(attempts.at(-1))}]:[]};}};}};}};
 const log=await gameLog(db,{...next,phase:'ENDED'});assert.equal(log.events[0].detail.thinking,'ACCEPTED_MARKER');assert.equal(log.modelUsage.at(-1).thinking,'ACCEPTED_MARKER');
 }finally{globalThis.fetch=original;}
});

test('모든 생성이 실패하면 기존 생각을 보존하고 네이티브 thought와 JSON thinking을 구별한다',async()=>{
 const original=globalThis.fetch;const g=setup();g.privateThinking={ai1:{text:'OLD_VALID_MEMORY'}};const attempts=[];
 try{
  globalThis.fetch=async()=>response({type:'CARD',choice:'FAIL',thinking:'INVALID_ACTION_THINKING'});
  await assert.rejects(()=>decide(g,{actor:'ai1',type:'CHAT'},'mock',null,{onUsage:r=>attempts.push(r)}));
  assert.equal(g.privateThinking.ai1.text,'OLD_VALID_MEMORY');assert.equal(attempts.filter(r=>r.thinking).length,2);
  globalThis.fetch=async()=>Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,thoughtsTokenCount:20,totalTokenCount:150},candidates:[{content:{parts:[{thought:true,text:'NATIVE_SUMMARY_MARKER'},{text:JSON.stringify({type:'CHAT',text:'공개 근거를 확인하겠습니다.',speechAct:'ANSWER',thinking:'JSON_MEMORY_MARKER'})}]}}]});
  const d=await decide(g,{actor:'ai1',type:'CHAT'},'mock');assert.equal(d.thinking,'JSON_MEMORY_MARKER');assert.equal(d.usage.thoughts,20);assert.ok(!JSON.stringify(d).includes('NATIVE_SUMMARY_MARKER'));
 }finally{globalThis.fetch=original;}
});
