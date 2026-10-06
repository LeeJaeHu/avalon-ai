import test from 'node:test';import assert from 'node:assert/strict';
import{createGame,apply,observe,IDS,SPEECH_ACTS}from'../lib/game.mjs';
import{decide,nextAiAction}from'../lib/ai.mjs';
import{progressOptions,progressDecision,conversationDueAt}from'../lib/conversation.mjs';
import{routingPayload,JEV_MODEL}from'../lib/discussion-routing.mjs';
function start(){let g=createGame(()=>.5);g.leader='human';g.aiConfig={routingMode:'jev',conversationVersion:1};g=apply(g,'human',{type:'START'});return apply(g,'human',{type:'PROPOSE',team:['human','ai1']});}
const chat=(g,actor='ai1')=>apply(g,actor,{type:'CHAT',text:'초안의 이유를 함께 확인하겠습니다.',speechAct:'ANSWER'});

test('투표와 결과 이동을 8초 예고하고 읽기 정지·재개·질문 취소를 보존한다',()=>{
 let g=chat(chat(start()),'ai2'),before=Date.now();g=apply(g,'system',{type:'ANNOUNCE_VOTE'});
 assert.ok(g.conversation.voteAt>=before+8000);assert.equal(nextAiAction(g,g.conversation.voteAt-1),null);
 g.conversation.voteAt=Date.now()-1;g=apply(g,'system',{type:'START_VOTE'});for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});
 before=Date.now();g=apply(g,'system',{type:'ANNOUNCE_CONTINUE'});const deadline=g.conversation.continueAt;
 assert.ok(deadline>=before+8000);assert.equal(observe(g).conversation.continueAt,deadline);assert.equal(nextAiAction(g,deadline-1),null);assert.throws(()=>apply(g,'system',{type:'CONTINUE'}));
 const paused=apply(g,'human',{type:'PAUSE'});assert.equal(nextAiAction(paused,deadline+10000),null);assert.equal(observe(paused).pausedAt,paused.pausedAt);paused.pausedAt-=30000;
 const resumed=apply(paused,'human',{type:'RESUME'});assert.ok(resumed.conversation.continueAt>=deadline+30000);assert.equal(nextAiAction(resumed),null);
 for(const action of [{type:'HUMAN_ACTIVE'},{type:'CHAT',text:'결과를 먼저 이야기해 주세요.',speechAct:'QUESTION'}])assert.equal(apply(g,'human',action).conversation.continueAt,null);
 g.conversation.continueAt=Date.now()-1;assert.equal(nextAiAction(g).type,'CONTINUE');g=apply(g,'system',{type:'CONTINUE'});assert.equal(g.phase,'QUEST');assert.equal(g.conversation.continueAt,null);
});

test('운영 재현: 진행 WAIT와 AI 응답을 분리하고 사람 발언은 WAIT/SILENCE 뒤에도 답한다',async()=>{
 const originalFetch=globalThis.fetch;let selected='ai2',geminiCalls=0,silenceFirst=false;
 const answer=(keys,choice)=>({type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))});
 try{globalThis.fetch=async(url,init)=>{
  if(url.includes('typesafe')){const p=JSON.parse(init.body);return Response.json({model:JEV_MODEL,usage:{input_tokens:1500},answers:{responder:answer(['ai1','ai2','ai3','ai4','WAIT'],selected),speechAct:answer(SPEECH_ACTS,'ANSWER'),progress:answer(Object.keys(p.questions.progress.criteria),'WAIT')}});}
  geminiCalls++;return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,totalTokenCount:130},candidates:[{content:{parts:[{text:JSON.stringify(silenceFirst&&geminiCalls===1?{type:'SILENCE'}:{type:'CHAT',text:'그 의견에 답하면, 성공했던 참가자를 다시 고려하는 근거는 합리적입니다.',speechAct:'ANSWER'})}]}}]});
 };
 let g=start();let d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(d.actor,'ai2');assert.equal(d.action.type,'CHAT');assert.equal(geminiCalls,1);
 g=apply(g,'human',{type:'CHAT',text:'성공한 참가자로 다시 가도 괜찮을까요?',speechAct:'OTHER'});selected='WAIT';geminiCalls=0;silenceFirst=true;
 d=await decide(g,nextAiAction(g),'mock',null,{key:'mock'});assert.equal(d.action.type,'CHAT');assert.equal(d.action.replyTo,g.pendingSpeech);assert.equal(geminiCalls,2);assert.equal(d.routing.recoveryReason,'HUMAN_REPLY_REQUIRED');
 assert.equal(progressDecision(g,{status:'OK',progress:'CONTINUE',selectedActor:'WAIT'}),null);
 }finally{globalThis.fetch=originalFetch;}
});

test('반복 WAIT 또는 JEV 장애에도 사람의 팀/표/카드만 받아 자동 완주하고 판별 호출을 제한한다',async()=>{
 const originalFetch=globalThis.fetch;try{
 for(const failure of [false,true]){
  let g=createGame(()=>.5);g.aiConfig={routingMode:'jev',conversationVersion:1,proposalPolicy:'A'};let jevCalls=0;const recovered=[];
  globalThis.fetch=async(url,init)=>{
   if(url.includes('typesafe')){jevCalls++;if(failure)throw Error('synthetic-offline');const p=JSON.parse(init.body),answer=(keys,choice)=>({type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))});return Response.json({model:JEV_MODEL,usage:{input_tokens:1000},answers:{responder:answer(['ai1','ai2','ai3','ai4','WAIT'],'WAIT'),speechAct:answer(SPEECH_ACTS,'OTHER'),progress:answer(Object.keys(p.questions.progress.criteria),'WAIT')}});}
   const prompt=JSON.parse(init.body).contents[0].parts[0].text,request=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
   const action=request.type==='CHAT'?{type:'CHAT',text:'현재 팀의 근거와 공개 결과를 확인했습니다.',speechAct:'ANSWER'}:request.type==='PROPOSE'?{type:'PROPOSE',team:IDS.slice(0,request.requiredTeamSize)}:request.type==='VOTE'?{type:'VOTE',choice:'APPROVE'}:request.type==='CARD'?{type:'CARD',choice:'SUCCESS'}:{type:'ASSASSINATE',target:IDS.find(id=>id!==request.actor)};
   return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,totalTokenCount:130},candidates:[{content:{parts:[{text:JSON.stringify(action)}]}}]});
  };
  g=apply(g,'human',{type:'START'});
  for(let i=0;i<160&&g.phase!=='ENDED';i++){
   if(g.conversation?.voteAt)g.conversation.voteAt=Date.now()-1;
   if(g.conversation?.continueAt)g.conversation.continueAt=Date.now()-1;
   const r=nextAiAction(g,Date.now()+60000);
   if(r){if(r.recoveryReason)recovered.push(r.type);const d=r.actor==='system'?{actor:'system',action:{type:r.type}}:await decide(g,r,'mock',null,{key:'mock'});if(d.routing?.recoveryReason)recovered.push(d.action.type);g=apply(g,d.actor,d.action);}
   else if(g.phase==='PROPOSE')g=apply(g,'human',{type:'PROPOSE',team:IDS.slice(0,observe(g).size)});
   else if(g.phase==='VOTE')g=apply(g,'human',{type:'VOTE',choice:'APPROVE'});
   else if(g.phase==='QUEST')g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});
   else if(g.phase==='ASSASSINATE')g=apply(g,'human',{type:'ASSASSINATE',target:'ai1'});
   else assert.fail(`자동 복구가 멈춤: ${g.phase}`);
  }
  assert.equal(g.phase,'ENDED');assert.ok(recovered.includes('ANNOUNCE_VOTE'));assert.ok(recovered.includes('ANNOUNCE_CONTINUE'));assert.ok(jevCalls<35,`무한 판별 호출: ${jevCalls}`);
 }
 }finally{globalThis.fetch=originalFetch;}
});
test('발언 2회·미답변 질문·수정 권한을 기준으로 진행 후보를 제한한다',()=>{
 let g=start();assert.deepEqual(progressOptions(g),['TALK','WAIT']);g=chat(chat(g),'ai2');assert.ok(progressOptions(g).includes('OPEN_VOTE'));
 assert.ok(!progressOptions(g).includes('REVISE'));g=apply(g,'human',{type:'CHAT',text:'잠깐, 이유를 먼저 설명해 주세요.',speechAct:'QUESTION'});
 assert.ok(!progressOptions(g).includes('OPEN_VOTE'));assert.throws(()=>apply(g,'system',{type:'ANNOUNCE_VOTE'}));
 g=chat(g);g.leader='ai2';assert.ok(progressOptions(g).includes('REVISE'));g=apply(g,'system',{type:'REQUEST_REVISION'});assert.ok(!progressOptions(g).includes('REVISE'));
});
test('투표 예고 유예·입력/추가 대화 취소·일시정지·실제 제출 경계를 유지한다',()=>{
 let g=chat(chat(start()),'ai2');g=apply(g,'system',{type:'ANNOUNCE_VOTE'});assert.equal(nextAiAction(g),null);
 assert.throws(()=>apply(g,'system',{type:'START_VOTE'}));const at=g.conversation.voteAt;assert.equal(nextAiAction(g,at).type,'START_VOTE');
 const paused=apply(g,'human',{type:'PAUSE'});assert.equal(nextAiAction(paused,at),null);paused.pausedAt-=10000;
 const resumed=apply(paused,'human',{type:'RESUME'});assert.ok(resumed.conversation.voteAt>=at+10000);assert.equal(nextAiAction(resumed),null);
 for(const type of ['HUMAN_ACTIVE','DEFER_VOTE']){const n=apply(g,'human',{type});assert.equal(n.conversation.voteAt,null);assert.equal(nextAiAction(n),null);}
 const question=apply(g,'human',{type:'CHAT',text:'다른 후보도 있나요?',speechAct:'QUESTION'});assert.equal(question.conversation.voteAt,null);assert.equal(question.conversation.burst,0);
 g.conversation.voteAt=Date.now()-1;g=apply(g,'system',{type:'START_VOTE'});assert.equal(g.phase,'VOTE');assert.deepEqual(g.votes,{});
 assert.throws(()=>apply(g,'system',{type:'CONTINUE'}));assert.throws(()=>apply(g,'ai1',{type:'CARD',choice:'FAIL'}));
});
test('연속 발언 상한·결과 최소 노출·정지 및 이전 판 호환',()=>{
 let g=chat(chat(chat(start()),'ai2'),'ai3');assert.equal(progressDecision(g,{status:'OK',progress:'TALK'}).action.type,'SILENCE');
 g=apply(g,'system',{type:'SILENCE',idleTrigger:true});assert.equal(g.pendingDiscussion,null);
 const old={...g,aiConfig:{routingMode:'jev'}};assert.equal(progressDecision(old,{status:'OK',progress:'TALK'}),null);
 g=apply(g,'human',{type:'START_VOTE'});for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});
 assert.equal(g.phase,'VOTE_RESULT');assert.equal(nextAiAction(g),null);assert.equal(nextAiAction(g,conversationDueAt(g)).type,'DISCUSS');
 assert.equal(progressDecision(g,{status:'OK',progress:'CONTINUE'}).action.type,'ANNOUNCE_CONTINUE');g=apply(g,'system',{type:'ANNOUNCE_CONTINUE'});g.conversation.continueAt=Date.now()-1;g=apply(g,'system',{type:'CONTINUE'});assert.equal(g.phase,'QUEST');
 g.phase='QUEST_RESULT';g.idleCount=2;assert.ok(conversationDueAt(g));assert.equal(nextAiAction(g,Date.now()+60000).type,'ANNOUNCE_CONTINUE');
});
test('진행 입력의 공개 경계와 실패 대체, 같은 요청의 JEV 선택→생성 경로',async()=>{
 let g=start();g=chat(chat(g),'ai2');const payload=routingPayload(g,nextAiAction(g));const altered=structuredClone(g);altered.roles={human:'MINION'};altered.cards={ai1:'FAIL'};altered.votes={ai1:'REJECT'};
 assert.deepEqual(routingPayload(altered,nextAiAction(g)),payload);assert.ok(!JSON.stringify(payload).includes('"roles"'));
 const originalFetch=globalThis.fetch;let calls=0;const ledger=[];
 try{globalThis.fetch=async(url,init)=>{calls++;assert.ok(url.includes('typesafe'));const p=JSON.parse(init.body);const answer=(keys,choice)=>({type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))});
 return Response.json({model:JEV_MODEL,usage:{input_tokens:1500},answers:{responder:answer(['ai1','ai2','ai3','ai4','WAIT'],'ai3'),speechAct:answer(SPEECH_ACTS,'OTHER'),progress:answer(Object.keys(p.questions.progress.criteria),'OPEN_VOTE')}});};
 const d=await decide(g,nextAiAction(g),'mock',null,{key:'mock',onUsage:r=>ledger.push(r)});assert.equal(d.action.type,'ANNOUNCE_VOTE');assert.equal(calls,1);assert.equal(ledger.at(-1).input,1500);
 globalThis.fetch=async()=>{throw Error('private-failure')};const fallback=progressDecision(g,{status:'FALLBACK',progress:'OPEN_VOTE'});assert.equal(fallback,null);
 }finally{globalThis.fetch=originalFetch;}
});

test('모의 모델로 세 판 자동 진행·찬반/카드와 비용 기록을 끝까지 연결한다',async()=>{
 const originalFetch=globalThis.fetch;try{
 for(const seed of [.2,.5,.8]){
  let g=createGame(()=>seed);g.aiConfig={routingMode:'jev',conversationVersion:1,usageTrackingVersion:1,proposalPolicy:'A'};
  const records=new Map();let jevCalls=0;
  globalThis.fetch=async(url,init)=>{
   if(url.includes('typesafe')){
    jevCalls++;const p=JSON.parse(init.body),answer=(keys,choice)=>({type:'choice',choice,confidence:1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?1:0]))});
    const options=Object.keys(p.questions.progress.criteria),progress=options.includes('OPEN_VOTE')?'OPEN_VOTE':options.includes('CONTINUE')?'CONTINUE':'TALK';
    const actor=IDS.slice(1).find(id=>id!==p.state.messages.at(-1)?.actor);
    return Response.json({model:JEV_MODEL,usage:{input_tokens:1100},answers:{responder:answer(['ai1','ai2','ai3','ai4','WAIT'],actor),speechAct:answer(SPEECH_ACTS,'ANSWER'),progress:answer(options,progress)}});
   }
   const prompt=JSON.parse(init.body).contents[0].parts[0].text;
   const request=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
   const action=request.type==='CHAT'?{type:'CHAT',text:'선정 근거를 확인하고 다른 의견도 듣겠습니다.',speechAct:'ANSWER'}:
    request.type==='PROPOSE'?{type:'PROPOSE',team:IDS.slice(0,request.requiredTeamSize)}:
    request.type==='VOTE'?{type:'VOTE',choice:'APPROVE'}:request.type==='CARD'?{type:'CARD',choice:'SUCCESS'}:{type:'ASSASSINATE',target:IDS.find(id=>id!==request.actor)};
   return Response.json({usageMetadata:{promptTokenCount:2000,candidatesTokenCount:100,thoughtsTokenCount:25,totalTokenCount:2125},candidates:[{content:{parts:[{text:JSON.stringify(action)}]}}]});
  };
  g=apply(g,'human',{type:'START'});
  for(let i=0;i<160&&g.phase!=='ENDED';i++){
   if(g.conversation?.voteAt)g.conversation.voteAt=Date.now()-1;
   if(g.conversation?.continueAt)g.conversation.continueAt=Date.now()-1;
   const r=nextAiAction(g,Date.now()+60000);
   if(r){const d=r.actor==='system'?{actor:'system',action:{type:r.type}}:await decide(g,r,'mock',null,{key:'mock',onUsage:item=>records.set(item.id,item)});g=apply(g,d.actor,d.action);}
   else if(g.phase==='PROPOSE')g=apply(g,'human',{type:'PROPOSE',team:IDS.slice(0,observe(g).size)});
   else if(g.phase==='VOTE')g=apply(g,'human',{type:'VOTE',choice:'APPROVE'});
   else if(g.phase==='QUEST')g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});
   else if(g.phase==='ASSASSINATE')g=apply(g,'human',{type:'ASSASSINATE',target:IDS.find(id=>id!=='human')});
   else assert.fail(`자동 진행이 멈춤: ${g.phase}`);
   if(g.phase!=='ENDED'){const view=observe(g);assert.ok(!Object.hasOwn(view,'cards'));assert.ok(!Object.hasOwn(view,'roles'));}
  }
  assert.equal(g.phase,'ENDED');assert.ok(jevCalls>=3);assert.equal(records.size,[...records.values()].filter(r=>r.status!=='REQUESTED').length);
  assert.ok([...records.values()].some(r=>r.provider==='gemini'&&r.thoughts===25));
 }
 }finally{globalThis.fetch=originalFetch;}
});
