import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,observe,observeModerator,apply} from '../lib/game.mjs';
import {randomGameGeminiModel,MODEL_ASSIGNMENT_VERSION,modelHidden,modelGuessPending} from '../lib/gemini-models.mjs';
import {compareModelLogs,COMPARISON_VERSION} from '../lib/comparison.mjs';
const lite='gemini-3.5-flash-lite',flash='gemini-3.5-flash';
const game=()=>({...createGame(()=>.5),aiConfig:{model:lite,modelAssignmentVersion:MODEL_ASSIGNMENT_VERSION,comparisonVersion:COMPARISON_VERSION,routingMode:'jev',actionMode:'jev'}});
test('fair server draw boundaries select each model without rounding bias',()=>{
  for(const value of [0,0x7fffffff])assert.equal(randomGameGeminiModel(()=>value),lite);
  for(const value of [0x80000000,0xffffffff])assert.equal(randomGameGeminiModel(()=>value),flash);
  for(const value of [-1,2**32,.5,NaN])assert.throws(()=>randomGameGeminiModel(()=>value));
});

test('기존 blind-v1/v2 판도 추측 전 숨기고 새 판 추측 후에만 추론 수준을 공개한다',()=>{
 const old={...game(),aiConfig:{...game().aiConfig,modelAssignmentVersion:'random-blind-v1'}};
 assert.equal(modelHidden(old),true);old.phase='ENDED';old.winner='GOOD';
 assert.equal(apply(old,'human',{type:'MODEL_GUESS',choice:lite}).modelGuess.version,'random-blind-v1');
 const previous={...game(),phase:'ENDED',winner:'GOOD',aiConfig:{...game().aiConfig,modelAssignmentVersion:'random-blind-thinking-v2',thinkingLevel:'MEDIUM'}};
 assert.equal(modelHidden(previous),true);assert.equal(apply(previous,'human',{type:'MODEL_GUESS',choice:lite}).modelGuess.actualThinkingLevel,'MEDIUM');
 const current={...game(),phase:'ENDED',winner:'GOOD'};current.aiConfig.thinkingLevel='HIGH';
 assert.equal(observe(current).modelGuess.actualThinkingLevel,undefined);
 assert.equal(apply(current,'human',{type:'MODEL_GUESS',choice:lite}).modelGuess.actualThinkingLevel,'HIGH');
});
test('human guess is hidden from AI and moderator; unfinished and invalid guesses rejected',()=>{
  const g=game();assert.equal(modelHidden(g),true);assert.equal(modelGuessPending(g),false);
  assert.deepEqual(observe(g).modelGuess,{hidden:true,pending:false,submitted:false});
  assert.equal(observe(g,'ai1').modelGuess,undefined);assert.equal(observeModerator(g).modelGuess,undefined);
  assert.throws(()=>apply(g,'human',{type:'MODEL_GUESS',choice:lite}));
  g.phase='ENDED';g.winner='GOOD';
  for(const actor of ['ai1','system'])assert.throws(()=>apply(g,actor,{type:'MODEL_GUESS',choice:lite}));
  for(const choice of [undefined,null,'other'])assert.throws(()=>apply(g,'human',{type:'MODEL_GUESS',choice}));
});
test('one final guess persists and reveals identity without changing game outcome',()=>{
  const g={...game(),phase:'ENDED',winner:'EVIL'};
  const next=apply(g,'human',{type:'MODEL_GUESS',choice:flash});
  assert.equal(next.version,g.version+1);assert.equal(next.winner,g.winner);assert.equal(next.modelGuess.correct,false);
  assert.equal(next.aiConfig.model,lite);assert.equal(modelHidden(next),false);assert.equal(observe(next).modelGuess.actualModel,lite);
  assert.throws(()=>apply(next,'human',{type:'MODEL_GUESS',choice:lite}));assert.equal(g.modelGuess,undefined);
  for(const aiConfig of [{model:lite},{model:null,modelAssignmentVersion:MODEL_ASSIGNMENT_VERSION}])assert.throws(()=>apply({...g,aiConfig},'human',{type:'MODEL_GUESS',choice:lite}));
  assert.throws(()=>apply({...g,endReason:'RESTARTED'},'human',{type:'MODEL_GUESS',choice:lite}));
});
test('model identification uses submitted completed games as denominator, separate from role scores',()=>{
  const logs=[lite,flash,null].map((choice,i)=>({format:'avalon-game-log-v1',game:{...game(),id:String(i),phase:'ENDED',winner:'GOOD',...(choice?{modelGuess:{choice}}:{})},modelUsage:[],events:[]}));
  logs.push({format:'avalon-game-log-v1',game:{...game(),id:'restart',phase:'ENDED',winner:null,endReason:'RESTARTED',modelGuess:{choice:lite}},modelUsage:[],events:[]});
  const summary=compareModelLogs(logs).byMode.hybrid;
  assert.equal(summary.completedGames,3);assert.equal(summary.modelGuessGames,2);assert.equal(summary.modelGuessAccuracy,.5);assert.equal(summary.guessAccuracy,null);
});
