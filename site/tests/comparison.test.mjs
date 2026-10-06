import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPARISON_VERSION,comparisonMode,comparisonPreset,compareModelLogs} from '../lib/comparison.mjs';
import {createGame,apply} from '../lib/game.mjs';
import {decide} from '../lib/ai.mjs';
import {JEV_MODEL} from '../lib/discussion-routing.mjs';
const log=(id,mode='gemini')=>({format:'avalon-game-log-v1',game:{id,phase:'ENDED',winner:'GOOD',roles:{human:'LOYAL',ai1:'MERLIN'},
  aiConfig:{...comparisonPreset(mode),comparisonVersion:COMPARISON_VERSION,model:'test-model',promptVersion:'V3',proposalPolicy:'A',usageTrackingVersion:1},roleGuess:{correct:3,total:4}},
  modelUsage:[{provider:'gemini',costUsd:.01,latencyMs:200,status:'RESPONDED'}],events:[]});
test('두 프리셋은 모델 선택 두 항목을 함께 확정하며 잘못된 값은 거부한다',()=>{
  assert.deepEqual(comparisonPreset('gemini'),{routingMode:'baseline',actionMode:'gemini'});
  assert.deepEqual(comparisonPreset('hybrid'),{routingMode:'jev',actionMode:'jev'});
  for(const mode of ['gemini','hybrid'])assert.equal(comparisonMode(comparisonPreset(mode)),mode);
  assert.equal(comparisonMode({routingMode:'jev',actionMode:'gemini'}),'custom');
  for(const bad of [null,{},'',1,'custom','toString'])assert.throws(()=>comparisonPreset(bad));
});
test('비교는 중복·중단·연습·과거 판과 누락 비용/미제출 점수를 구분한다',()=>{
  const a=log('a'),b=log('b','hybrid');b.modelUsage.push({provider:'jev',costUsd:null,latencyMs:100,errorCode:'HTTP_503',status:'FALLBACK'});b.game.roleGuess=null;
  const restart=log('c');restart.game.endReason='RESTARTED';
  const practice=log('d');practice.game.aiConfig.model=null;
  const legacy=log('e');delete legacy.game.aiConfig.comparisonVersion;
  const result=compareModelLogs([a,{...a,exportedAt:'other'},b,restart,practice,legacy]);
  assert.equal(result.uniqueGames,5);assert.equal(result.duplicates,1);
  assert.equal(result.byMode.gemini.completedGames,1);assert.equal(result.byMode.gemini.meanCostUsd,.01);
  assert.equal(result.byMode.hybrid.costCompleteGames,0);assert.equal(result.byMode.hybrid.meanCostUsd,null);
  assert.equal(result.byMode.hybrid.meanCallLatencyMs,150);assert.equal(result.byMode.hybrid.recordedErrorCalls,1);
  assert.equal(result.byMode.hybrid.guessAccuracy,null);assert.equal(result.byMode.gemini.guessAccuracy,.75);
  assert.equal(result.byConditions.find(g=>g.conditions.model==='test-model'&&g.conditions.comparisonVersion===COMPARISON_VERSION).byMode.hybrid.completedGames,1);
  assert.throws(()=>compareModelLogs([a,{...a,modelUsage:[]}]),/같은 게임/);
  assert.throws(()=>compareModelLogs([{}]));
});
test('동일한 투표 관찰에서 Gemini 단독과 혼합은 지정한 행동 제공자만 호출한다',async()=>{
  const g=apply(createGame(()=>.5),'human',{type:'START'});g.phase='VOTE';g.team=['human','ai1'];
  const original=globalThis.fetch,calls=[];
  try{globalThis.fetch=async(url)=>{calls.push(String(url));return Response.json({usageMetadata:{promptTokenCount:10,candidatesTokenCount:10},candidates:[{content:{parts:[{text:JSON.stringify({type:'VOTE',choice:'APPROVE'})}]}}]});};
    g.aiConfig={...comparisonPreset('gemini'),proposalPolicy:'A'};
    const one=await decide(g,{type:'VOTE',actor:'ai1'},'mock',null,{key:'mock',fetchImpl:async()=>{throw Error('JEV must not be called');}});
    assert.equal(one.mode,'gemini');assert.equal(calls.length,1);
    g.aiConfig={...comparisonPreset('hybrid'),proposalPolicy:'A'};calls.length=0;let jevCalls=0;
    const two=await decide(g,{type:'VOTE',actor:'ai1'},'mock',null,{key:'mock',fetchImpl:async()=>{jevCalls++;return Response.json({model:JEV_MODEL,usage:{input_tokens:10},answers:{action:{type:'choice',choice:'APPROVE',confidence:1,probabilities:{APPROVE:1,REJECT:0}}}});}});
    assert.equal(two.mode,'jev');assert.equal(jevCalls,1);assert.equal(calls.length,0);
  }finally{globalThis.fetch=original;}
});
