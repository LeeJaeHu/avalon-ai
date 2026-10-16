import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,apply} from '../lib/game.mjs';
import {decide,classifyHumanSpeech} from '../lib/ai.mjs';
import {newGameGeminiModel,GEMINI_MODEL_COMPARISON_VERSION,newGameGeminiGeneration,geminiGeneration} from '../lib/gemini-models.mjs';
import {geminiUsage} from '../lib/usage.mjs';
import {compareModelLogs,COMPARISON_VERSION,comparisonPreset} from '../lib/comparison.mjs';

test('모델 허용 목록과 Lite/Flash 단가·캐시·추론·버전 경계를 확인한다',()=>{
 assert.equal(newGameGeminiModel(),'gemini-3.5-flash-lite');
 for(const bad of ['other','gemini-3.5-flash-lite-fake',null,{},'toString'])assert.throws(()=>newGameGeminiModel(bad));
 const metadata={promptTokenCount:2000,candidatesTokenCount:100,thoughtsTokenCount:300,cachedContentTokenCount:1000};
 assert.ok(Math.abs(geminiUsage(metadata,'gemini-3.5-flash-001').costUsd-.00525)<1e-12);
 assert.ok(Math.abs(geminiUsage(metadata).costUsd-.00133)<1e-12);
 assert.equal(geminiUsage(metadata,'gemini-3.5-flash-lite-fake').costUsd,null);
});
test('대화·분류·재시도와 직접 API/중계 요청이 판에 고정된 모델을 사용한다',async()=>{
 const original=globalThis.fetch;let g=apply(createGame(()=>.5),'human',{type:'START'});g.aiConfig={model:'gemini-3.5-flash'};
 try{
  for(const key of ['mock',{url:'https://mock.invalid/generate',token:'mock'}]){
   const calls=[],records=[];
   globalThis.fetch=async(url,init)=>{const input=JSON.parse(init.body);calls.push({url:String(url),input});return Response.json({modelVersion:'gemini-3.5-flash-001',usageMetadata:{promptTokenCount:10,candidatesTokenCount:10},candidates:[{content:{parts:[{text:calls.length===1?'invalid':JSON.stringify({type:'CHAT',text:'초안을 살펴볼게요.',speechAct:'ANSWER'})}]}}]});};
   await decide(g,{actor:'ai1',type:'CHAT'},key,null,{onUsage:r=>records.push(r)});
   assert.equal(calls.length,2);assert.ok(records.every(r=>r.requestedModel==='gemini-3.5-flash'));
   for(const call of calls)if(typeof key==='string')assert.match(call.url,/\/gemini-3.5-flash:generateContent$/);else assert.equal(call.input.model,'gemini-3.5-flash');
  }
  globalThis.fetch=async(url)=>{assert.match(String(url),/\/gemini-3.5-flash:generateContent$/);return Response.json({candidates:[{content:{parts:[{text:'{"speechAct":"QUESTION"}'}]}}]});};
  assert.equal((await classifyHumanSpeech(g,'누구를 보내나요?',null,'mock')).speechAct,'QUESTION');
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({modelVersion:'gemini-3.5-flash-lite',candidates:[]});};
  await assert.rejects(decide(g,{actor:'ai1',type:'CHAT'},'mock'),e=>e.code==='MODEL_MISMATCH');assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('새 JEV 모델 실험만 모델별 집계하고 모델 외 조건/시작 역할별 분모를 유지한다',()=>{
 const log=(id,model,role='LOYAL')=>({format:'avalon-game-log-v1',game:{id,phase:'ENDED',winner:'GOOD',roles:{human:role},aiConfig:{...comparisonPreset('hybrid'),model,...newGameGeminiGeneration(model),comparisonVersion:COMPARISON_VERSION,modelComparisonVersion:GEMINI_MODEL_COMPARISON_VERSION,usageTrackingVersion:1,actionModel:'jev-1.13.0'},roleGuess:{correct:2,total:4,factionCorrect:4,factionTotal:4}},modelUsage:[{costUsd:.01}],events:[]});
 const a=log('lite','gemini-3.5-flash-lite'),b=log('flash','gemini-3.5-flash'),c=log('old','gemini-3.5-flash');delete c.game.aiConfig.modelComparisonVersion;
 const d=log('single','gemini-3.5-flash');Object.assign(d.game.aiConfig,comparisonPreset('gemini'));
 const e=log('merlin','gemini-3.5-flash','MERLIN');
 const r=compareModelLogs([a,b,c,d,e]);assert.equal(r.byGeminiModel['gemini-3.5-flash'].completedGames,2);assert.equal(r.byGeminiModel['gemini-3.5-flash'].excludedGames,2);
 const group=r.byGeminiModelConditions.find(g=>g.conditions.modelComparisonVersion===GEMINI_MODEL_COMPARISON_VERSION&&g.conditions.humanRole==='LOYAL'&&g.byModel['gemini-3.5-flash-lite'].completedGames===1);
 assert.equal(group.byModel['gemini-3.5-flash'].completedGames,1);assert.equal(group.byModel['gemini-3.5-flash'].factionGuessAccuracy,1);
 const legacy=structuredClone(b);legacy.game.id='old-tier';legacy.game.aiConfig.modelComparisonVersion='gemini-tier-v1';
 const bad=structuredClone(b);bad.game.id='wrong-level';bad.game.aiConfig.thinkingLevel='LOW';
 const excluded=compareModelLogs([legacy,bad]);assert.equal(excluded.byGeminiModel['gemini-3.5-flash'].completedGames,0);assert.equal(excluded.byGeminiModel['gemini-3.5-flash'].excludedGames,2);
 const previous=structuredClone(a);Object.assign(previous.game.aiConfig,{modelComparisonVersion:'gemini-thinking-pair-v2',geminiGenerationVersion:'thinking-pair-v1',modelAssignmentVersion:'random-blind-thinking-v2',thinkingLevel:'MEDIUM'});
 const previousResult=compareModelLogs([previous]);assert.equal(previousResult.byGeminiModel['gemini-3.5-flash-lite'].completedGames,0);assert.equal(previousResult.byGeminiModel['gemini-3.5-flash-lite'].excludedGames,1);
});

test('Lite HIGH/Flash MINIMAL 설정은 대화·분류·중계·재시도와 사용량에 일관되고 과거 판은 유지한다',async()=>{
 assert.deepEqual(geminiGeneration({model:'gemini-3.5-flash'}),{maxOutputTokens:768});
 for(const model of ['gemini-3.5-flash-lite','gemini-3.5-flash'])assert.deepEqual(geminiGeneration({model,geminiGenerationVersion:'thinking-pair-v1',thinkingLevel:model.endsWith('lite')?'MEDIUM':'MINIMAL',maxOutputTokens:8192}),{maxOutputTokens:8192,thinkingConfig:{thinkingLevel:model.endsWith('lite')?'MEDIUM':'MINIMAL'}});
 const original=globalThis.fetch;
 try{
  for(const model of ['gemini-3.5-flash-lite','gemini-3.5-flash']){
   const settings=newGameGeminiGeneration(model),expected=model.endsWith('lite')?'HIGH':'MINIMAL';
   const game=apply(createGame(()=>.5),'human',{type:'START'});game.aiConfig={model,...settings};
   for(const key of ['mock',{url:'https://mock.invalid/generate',token:'mock'}]){
    const calls=[],usage=[];
    globalThis.fetch=async(_url,init)=>{const input=JSON.parse(init.body);calls.push(input);assert.equal(input.generationConfig.thinkingConfig.thinkingLevel,expected);assert.equal(input.generationConfig.maxOutputTokens,8192);return Response.json({modelVersion:model,candidates:[{finishReason:calls.length===1?'MAX_TOKENS':'STOP',content:{parts:[{text:calls.length===1?'{':JSON.stringify({type:'CHAT',text:'현재 팀 구성을 확인해요.',speechAct:'QUESTION'})}]}}]});};
    await decide(game,{actor:'ai2',type:'CHAT'},key,null,{onUsage:r=>usage.push(r)});
    assert.equal(calls.length,2);assert.ok(usage.every(r=>r.thinkingLevel===expected&&r.maxOutputTokens===8192));
    globalThis.fetch=async(_url,init)=>{const input=JSON.parse(init.body);assert.equal(input.generationConfig.thinkingConfig.thinkingLevel,expected);assert.equal(input.generationConfig.maxOutputTokens,8192);return Response.json({candidates:[{content:{parts:[{text:'{"speechAct":"QUESTION"}'}]}}]});};
    await classifyHumanSpeech(game,'팀은 누구인가요?',null,key);
   }
   assert.throws(()=>geminiGeneration({model,...settings,thinkingLevel:model.endsWith('lite')?'MEDIUM':'HIGH'}));
  }
 }finally{globalThis.fetch=original;}
});
