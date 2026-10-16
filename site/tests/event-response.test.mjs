import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,apply,IDS,observeModerator} from '../lib/game.mjs';
import {nextAiAction,decide} from '../lib/ai.mjs';
import {requiredDiscussionResponse,manualNextStep} from '../lib/conversation.mjs';
import {routingPayload,routeDiscussion,JEV_MODEL} from '../lib/discussion-routing.mjs';
import {responseSchema} from '../lib/response-schema.mjs';

function fresh(phase='TEAM_DISCUSSION') {
 let g=createGame(()=>.5);g.leader='human';g.aiConfig={conversationVersion:1,manualProgress:true,routingMode:'jev'};
 g=apply(g,'human',{type:'START'});g=apply(g,'human',{type:'PROPOSE',team:['human','ai1']});
 if(phase==='TEAM_DISCUSSION')return g;
 g=apply(g,'system',{type:'SILENCE'});g=apply(g,'human',{type:'START_VOTE'});
 for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});
 if(phase==='VOTE_RESULT')return g;
 g=apply(g,'system',{type:'SILENCE'});g=apply(g,'human',{type:'CONTINUE'});
 g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});return apply(g,'ai1',{type:'CARD',choice:'SUCCESS'});
}
const choice=(keys,selected)=>({type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))});
const jev=(need='TALK',actor='ai3')=>Response.json({model:JEV_MODEL,usage:{input_tokens:100},answers:{responder:choice(IDS.slice(1),actor),discussion:choice(['TALK','WAIT'],need)}});
const gemini=action=>Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30},candidates:[{content:{parts:[{text:JSON.stringify({thinking:'모의 자기보고',...action})}]}}]});
const chat={type:'CHAT',text:'하린 대신 도윤을 포함해 이전 팀과 비교하고 싶어요.',speechAct:'TEAM_SUGGESTION'};

test('새 팀·투표·원정 결과에서도 발언 필요성과 네 발언자를 별도 질문한다',()=>{
 for(const phase of ['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT']) {
  let g=fresh(phase),request=nextAiAction(g),p=routingPayload(g,request);
  assert.equal(requiredDiscussionResponse(g,request),null);assert.deepEqual(Object.keys(p.questions.responder.criteria),IDS.slice(1));
  assert.deepEqual(Object.keys(p.questions.discussion.criteria),['TALK','WAIT']);assert.equal(p.state.trigger.eventDiscussed,false);
  assert.equal(p.state.trigger.event.kind,phase==='TEAM_DISCUSSION'?'TEAM':phase);assert.ok(p.state.trigger.event.text);
  assert.ok(p.state.publicEvents.length);assert.ok(manualNextStep(g).disabled);
  g=apply(g,'ai2',chat);p=routingPayload(g,nextAiAction(g));
  assert.equal(p.state.trigger.requiredResponse,null);assert.equal(p.state.trigger.eventDiscussed,true);assert.ok(p.questions.discussion.criteria.WAIT);
 }
});

test('과거 채팅이 같아도 새 사건을 입력하며 비밀 정보는 복사하지 않는다',()=>{
 const g=fresh('QUEST_RESULT'),request=nextAiAction(g),p=routingPayload(g,request),altered=structuredClone(g);
 altered.roles={human:'MINION'};altered.privateThinking={ai1:'SECRET_THINKING'};altered.privateCards=[{secret:'SECRET_CARD'}];altered.roleGuess={secret:'SECRET_GUESS'};
 altered.publicEvents.at(-1).privateRole='SECRET_ROLE';
 assert.deepEqual(routingPayload(altered,request),p);assert.ok(!JSON.stringify(p).includes('SECRET_'));
 const changed=structuredClone(g);changed.publicEvents.at(-1).text='새 원정 실패 · 실패 카드 1장';
 assert.notDeepEqual(routingPayload(changed,request),p);
});

test('새 사건의 WAIT는 유효하며 Gemini 없이 종료하고 다음 질문은 재개한다',async()=>{
 const original=globalThis.fetch;try{for(const phase of ['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT']){
 let g=fresh(phase),calls=0;globalThis.fetch=async url=>{assert.ok(url.includes('typesafe'));calls++;return jev('WAIT');};
 const d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(calls,1);assert.equal(d.action.type,'SILENCE');assert.equal(d.routing.status,'OK');
 assert.equal(d.routing.discussionChoice,'WAIT');assert.equal(d.routing.responderChoice,'ai3');assert.equal(d.routing.selectedActor,'WAIT');
 g=apply(g,d.actor,d.action);assert.equal(nextAiAction(g,Date.now()+1e9),null);assert.equal(manualNextStep(g).disabled,false);
 g=apply(g,'human',{type:'CHAT',text:'이번 결과를 어떻게 생각해요?',speechAct:'QUESTION'});assert.equal(nextAiAction(g).type,'DISCUSS');
 }}finally{globalThis.fetch=original;}
});

test('TALK는 선택된 AI를 한 번 호출하며 Gemini SILENCE는 재시도 없이 종료한다',async()=>{
 const original=globalThis.fetch;try{
 for(const phase of ['TEAM_DISCUSSION','VOTE_RESULT','QUEST_RESULT']) {
  let g=fresh(phase),jevCalls=0,geminiCalls=0;
  globalThis.fetch=async(url,init)=>{
   const body=JSON.parse(init.body);
   if(url.includes('typesafe')){jevCalls++;return jev(jevCalls===1?'TALK':'WAIT');}
   geminiCalls++;assert.deepEqual(body.generationConfig.responseSchema.properties.type.enum,['CHAT','SILENCE']);
   assert.ok(body.contents[0].parts[0].text.includes('새 사건마다 반드시 말할 필요는 없습니다'));
   return gemini(chat);
  };
  let d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});
  assert.equal(d.actor,'ai3');assert.equal(d.action.type,'CHAT');assert.equal(geminiCalls,1);assert.equal(jevCalls,1);
  g=apply(g,d.actor,d.action);d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});
  assert.equal(d.action.type,'SILENCE');assert.equal(geminiCalls,1);g=apply(g,d.actor,d.action);assert.equal(nextAiAction(g),null);assert.equal(manualNextStep(g).disabled,false);
  g=fresh(phase);geminiCalls=0;globalThis.fetch=async url=>url.includes('typesafe')?jev('TALK'):(geminiCalls++,gemini({type:'SILENCE'}));
  d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(geminiCalls,1);assert.equal(d.action.type,'SILENCE');g=apply(g,d.actor,d.action);assert.equal(nextAiAction(g,Date.now()+1e9),null);
 }
 }finally{globalThis.fetch=original;}
});

test('연속 Gemini 실패는 두 호출에서 멈추고 선택된 AI의 오류로 기록한다',async()=>{
 const original=globalThis.fetch;let calls=0;try{
  globalThis.fetch=async url=>{if(url.includes('typesafe'))return jev('TALK','ai2');calls++;return gemini({type:'VOTE',choice:'APPROVE'});};
  const g=fresh();await assert.rejects(()=>decide(g,nextAiAction(g),'mock',null,{key:'mock'}),e=>e.code==='UNEXPECTED_ACTION'&&e.actor==='ai2');assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});

test('발언자 확률이 분산돼도 TALK 판단을 유지하고 잘못된 두 질문은 대체한다',async()=>{
 const g=fresh(),body={model:JEV_MODEL,usage:{input_tokens:100},answers:{discussion:{type:'choice',choice:'TALK',confidence:.6,probabilities:{TALK:.6,WAIT:.4}},responder:{type:'choice',choice:'ai2',confidence:.25,probabilities:{ai1:.25,ai2:.25,ai3:.25,ai4:.25}}}};
 const good=await routeDiscussion(g,nextAiAction(g),{mode:'jev',key:'mock',fetchImpl:async()=>Response.json(body)});assert.equal(good.actor,'ai2');assert.equal(good.record.discussionChoice,'TALK');
 for(const change of [b=>delete b.answers.discussion,b=>b.answers.discussion.choice='UNKNOWN',b=>b.answers.discussion.probabilities.WAIT=1,b=>b.answers.responder.choice='WAIT',b=>b.model='bad']){
  const bad=structuredClone(body);change(bad);let calls=0;const r=await routeDiscussion(g,nextAiAction(g),{mode:'jev',key:'mock',fetchImpl:async()=>{calls++;return Response.json(bad);}});assert.equal(calls,1);assert.equal(r.record.status,'FALLBACK');assert.ok(IDS.slice(1).includes(r.actor));
 }
 for(const fetchImpl of [async()=>new Response('',{status:503}),async()=>{throw Object.assign(new Error('synthetic'),{name:'TimeoutError'});}]){
  const r=await routeDiscussion(g,nextAiAction(g),{mode:'jev',key:'mock',fetchImpl});assert.equal(r.record.status,'FALLBACK');assert.ok(IDS.slice(1).includes(r.actor));
 }
 const shadow=await routeDiscussion(g,nextAiAction(g),{mode:'shadow',key:'mock',fetchImpl:async()=>jev('WAIT','ai3')});assert.equal(shadow.record.discussionChoice,'WAIT');assert.equal(shadow.record.applied,false);assert.equal(shadow.actor,shadow.record.baselineActor);
});

test('이름을 포함한 AI 후속 발언도 자율 침묵하며 사용자 질문에는 응답한다',async()=>{
 const original=globalThis.fetch;try{
 let g=apply(fresh(),'ai1',{type:'CHAT',text:'서아의 투표가 의심스러워요.',speechAct:'CHALLENGE'}),calls=0;
 globalThis.fetch=async url=>url.includes('typesafe')?jev('TALK','ai3'):(calls++,gemini({type:'SILENCE'}));
 let d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(d.action.type,'SILENCE');assert.equal(calls,1);
 g=apply(g,d.actor,d.action);g=apply(g,'human',{type:'CHAT',text:'서아는 어떻게 생각해요?',speechAct:'QUESTION'});calls=0;
 globalThis.fetch=async url=>url.includes('typesafe')?jev('WAIT','ai3'):(calls++,gemini(calls===1?{type:'SILENCE'}:chat));
 d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(d.actor,'ai3');assert.equal(d.action.type,'CHAT');assert.equal(calls,2);assert.equal(d.routing.recoveryReason,'HUMAN_REPLY_REQUIRED');
 }finally{globalThis.fetch=original;}
});

test('기존 모드·사용자 답변·세 발언 상한·과거 자동 진행을 보존한다',async()=>{
 const original=globalThis.fetch;try{
  let g=fresh();g.aiConfig.routingMode='baseline';let calls=0;
  globalThis.fetch=async url=>{assert.ok(!url.includes('typesafe'));calls++;return gemini(chat);};
  const d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(d.action.type,'CHAT');assert.equal(calls,1);
  for(const actor of ['ai1','ai2','ai3'])g=apply(g,actor,chat);assert.equal(nextAiAction(g).type,'SILENCE');
  g=apply(g,'system',{type:'SILENCE',idleTrigger:true});g=apply(g,'human',{type:'CHAT',text:'도윤은 어떻게 생각해요?',speechAct:'QUESTION'});
  assert.equal(requiredDiscussionResponse(g,nextAiAction(g)),'HUMAN_REPLY_REQUIRED');
  const answer=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(answer.action.type,'CHAT');assert.equal(answer.action.replyTo,g.pendingSpeech);
  const old=fresh();delete old.aiConfig.manualProgress;assert.equal(requiredDiscussionResponse(old,nextAiAction(old)),null);assert.ok(routingPayload(old,nextAiAction(old)).questions.responder.criteria.WAIT);
  assert.deepEqual(responseSchema({type:'CHAT'},observeModerator(g)).properties.type.enum,['CHAT','SILENCE']);
 }finally{globalThis.fetch=original;}
});
