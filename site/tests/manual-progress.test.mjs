import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,apply,observe,IDS,SPEECH_ACTS} from '../lib/game.mjs';
import {manualNextStep,conversationDueAt,progressDecision} from '../lib/conversation.mjs';
import {nextAiAction,idleDueAt,decide} from '../lib/ai.mjs';
import {routingPayload,JEV_MODEL} from '../lib/discussion-routing.mjs';
const setup=()=>{let g=createGame(()=>.5);g.leader='human';g.aiConfig={conversationVersion:1,manualProgress:true,routingMode:'jev',proposalPolicy:'A'};g=apply(g,'human',{type:'START'});return apply(g,'human',{type:'PROPOSE',team:['human','ai1']});};
const clear=g=>apply(g,'system',{type:'SILENCE',idleTrigger:true});
const chat=(g,actor='ai1')=>apply(g,actor,{type:'CHAT',text:'지금 팀은 하린 대신 도윤으로 바꾸어 비교하고 싶습니다.',speechAct:'TEAM_SUGGESTION'});

test('시간·과거 예고·JEV 진행 선택은 수동 단계 이동을 일으키지 않는다',()=>{
 let g=clear(setup());g.conversation.voteAt=1;g.conversation.continueAt=1;g.idleCount=100;
 assert.equal(conversationDueAt(g),null);assert.equal(idleDueAt(g),null);assert.equal(nextAiAction(g,Date.now()+1e9),null);
 assert.equal(progressDecision(g,{status:'OK',progress:'OPEN_VOTE'}),null);
 assert.throws(()=>apply(g,'system',{type:'ANNOUNCE_VOTE'}));assert.throws(()=>apply(g,'system',{type:'START_VOTE'}));
 const p=routingPayload(g,{type:'DISCUSS'});assert.ok(!p.questions.progress);assert.ok(!p.state.allowedProgress);
 assert.equal(manualNextStep(g).disabled,false);
});

test('미답변·준비·재검토·초안·선택·정지·미전송 입력과 중복 전환을 막는다',()=>{
 const pending=setup();assert.ok(manualNextStep(pending).disabled);assert.throws(()=>apply(pending,'human',{type:'START_VOTE'}));
 const g=clear(pending);assert.equal(manualNextStep(g).type,'START_VOTE');
 for(const options of [{busy:true},{aiBusy:true},{draft:true},{teamChanged:true}])assert.ok(manualNextStep(observe(g),options).disabled);
 for(const altered of [{...g,aiPending:true},{...g,revisionRequested:true},apply(g,'human',{type:'PAUSE'})])assert.ok(manualNextStep(altered).disabled);
 const q=apply(g,'human',{type:'CHAT',text:'하린, 이 팀의 근거는?',speechAct:'QUESTION'});assert.throws(()=>apply(q,'human',{type:'START_VOTE'}));
 const voting=apply(g,'human',{type:'START_VOTE'});assert.ok(manualNextStep(voting).disabled);assert.throws(()=>apply(voting,'human',{type:'CONTINUE'}));assert.throws(()=>apply(voting,'human',{type:'START_VOTE'}));
 for(const phase of ['PROPOSE','QUEST','ASSASSINATE','ENDED'])assert.ok(manualNextStep({...g,phase}).disabled);
});

test('3회 발언 후 새 모델 호출 없이 종료하고 사람 질문으로 다시 시작한다',()=>{
 let g=setup();for(const actor of ['ai1','ai2','ai3'])g=chat(g,actor);
 assert.deepEqual(nextAiAction(g),{actor:'system',type:'SILENCE',idleTrigger:true});
 g=clear(g);assert.equal(nextAiAction(g),null);assert.equal(manualNextStep(g).disabled,false);
 g=apply(g,'human',{type:'CHAT',text:'도윤, 다른 팀은 어떤가요?',speechAct:'QUESTION'});
 assert.equal(g.conversation.burst,0);assert.equal(nextAiAction(g).type,'DISCUSS');assert.ok(manualNextStep(g).disabled);
});

test('전원 선택 뒤 결과를 즉시 토론하고 수동 이동까지 결과를 유지한다',()=>{
 let g=apply(clear(setup()),'human',{type:'START_VOTE'});
 for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});
 assert.equal(g.phase,'VOTE_RESULT');assert.equal(nextAiAction(g).type,'DISCUSS');assert.throws(()=>apply(g,'human',{type:'CONTINUE'}));
 g=clear(g);assert.equal(nextAiAction(g,Date.now()+1e9),null);assert.throws(()=>apply(g,'system',{type:'CONTINUE'}));
 g=apply(g,'human',{type:'CONTINUE'});assert.equal(g.phase,'QUEST');
 g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});assert.ok(!Object.hasOwn(observe(g),'cards'));
 g=apply(g,'ai1',{type:'CARD',choice:'SUCCESS'});assert.equal(g.phase,'QUEST_RESULT');assert.equal(nextAiAction(g).type,'DISCUSS');
 g=apply(clear(g),'human',{type:'CONTINUE'});assert.equal(g.quest,1);assert.equal(g.phase,'PROPOSE');
});

test('JEV WAIT 및 장애에서도 질문에 답하고 수동 선택으로 전체 판을 마친다',async()=>{
 const original=globalThis.fetch;try{for(const failure of [false,true]){
  let g=setup(),jevCalls=0;const choice=(keys,selected)=>({type:'choice',choice:selected,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))});
  globalThis.fetch=async(url,init)=>{
   const body=JSON.parse(init.body);
   if(url.includes('typesafe')){jevCalls++;assert.ok(!body.questions.progress);if(failure)throw Error('mock-network');return Response.json({model:JEV_MODEL,usage:{input_tokens:1000},answers:{responder:choice(['ai1','ai2','ai3','ai4','WAIT'],'WAIT'),speechAct:choice(SPEECH_ACTS,'ANSWER')}});}
   const prompt=body.contents[0].parts[0].text,r=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
   const action=r.type==='CHAT'?{type:'CHAT',text:'도윤을 포함해 실패 팀과 한 명씩 비교하겠습니다.',speechAct:'ANSWER'}:r.type==='PROPOSE'?{type:'PROPOSE',team:IDS.slice(0,r.requiredTeamSize)}:r.type==='VOTE'?{type:'VOTE',choice:'APPROVE'}:r.type==='CARD'?{type:'CARD',choice:'SUCCESS'}:{type:'ASSASSINATE',target:IDS.find(id=>id!==r.actor)};
   return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:20},candidates:[{content:{parts:[{text:JSON.stringify({...action,thinking:'모의 자기보고'})}]}}]});
  };
  g=clear(g);g=apply(g,'human',{type:'CHAT',text:'누가 더 안전한가요?',speechAct:'QUESTION'});
  const answer=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(answer.action.type,'CHAT');g=apply(g,answer.actor,answer.action);
  for(let i=0;i<160&&g.phase!=='ENDED';i++){
   const r=nextAiAction(g,Date.now()+1e9);
   if(r){const d=r.actor==='system'?{actor:r.actor,action:{type:r.type,idleTrigger:r.idleTrigger}}:await decide(g,r,'mock',null,{key:'mock'});g=apply(g,d.actor,d.action);}
   else if(g.phase==='PROPOSE')g=apply(g,'human',{type:'PROPOSE',team:IDS.slice(0,observe(g).size)});
   else if(g.phase==='VOTE')g=apply(g,'human',{type:'VOTE',choice:'APPROVE'});
   else if(g.phase==='QUEST')g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});
   else if(g.phase==='ASSASSINATE')g=apply(g,'human',{type:'ASSASSINATE',target:'ai1'});
   else {const step=manualNextStep(g);assert.equal(step.disabled,false);g=apply(g,'human',{type:step.type});}
   if(g.phase!=='ENDED'){const v=observe(g);assert.ok(!Object.hasOwn(v,'roles'));assert.ok(!Object.hasOwn(v,'cards'));}
  }
  assert.equal(g.phase,'ENDED');assert.ok(jevCalls<35);
 }}finally{globalThis.fetch=original;}
});
