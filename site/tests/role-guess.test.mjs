import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,apply,observe,observeModerator,IDS} from '../lib/game.mjs';
import {roleGuessPending,ROLE_GUESS_VERSION} from '../lib/role-guess.mjs';
import {nextAiAction} from '../lib/ai.mjs';import {manualNextStep} from '../lib/conversation.mjs';import {actionPayload} from '../lib/action-selection.mjs';import {gameLog} from '../lib/game-log.mjs';
const setup=(result='SUCCESS')=>({...createGame(()=>.5),phase:'QUEST_RESULT',quests:Array.from({length:3},(_,i)=>({id:`quest-${i+1}`,team:['ai1','ai2'],fails:result==='FAIL'?1:0,result})),
  roles:{human:'LOYAL',ai1:'MERLIN',ai2:'LOYAL',ai3:'ASSASSIN',ai4:'MINION'},aiConfig:{manualProgress:true,conversationVersion:1,roleGuessVersion:ROLE_GUESS_VERSION,actionMode:'jev',policyVersion:'test'},pendingDiscussion:'result',conversation:{burst:0,turns:0}});
const correct={ai1:'MERLIN',ai2:'LOYAL',ai3:'ASSASSIN',ai4:'MINION'};

test('세 번째 성공/실패에서 추측 전 진행 차단, 점수는 종료 후에만 공개한다',()=>{
 for(const result of ['SUCCESS','FAIL']){let g=setup(result);assert.ok(roleGuessPending(g));assert.equal(nextAiAction(g),null);assert.equal(manualNextStep(g).disabled,true);
  assert.throws(()=>apply(g,'human',{type:'CONTINUE'}));assert.throws(()=>apply(g,'human',{type:'CHAT',text:'계속',speechAct:'OTHER'}));
  g=apply(g,'human',{type:'ROLE_GUESS',guesses:correct});assert.equal(g.roleGuess.correct,4);assert.equal(g.roleGuess.total,4);assert.equal(g.roleGuess.humanRole,'LOYAL');
  assert.deepEqual(observe(g).roleGuess,{pending:false,submitted:true});assert.ok(!Object.hasOwn(observe(g,'ai1'),'roleGuess'));assert.ok(!Object.hasOwn(observeModerator(g),'roleGuess'));assert.throws(()=>apply(g,'human',{type:'ROLE_GUESS',guesses:correct}));
  g=apply(g,'system',{type:'SILENCE',idleTrigger:true});g=apply(g,'human',{type:'CONTINUE'});
  if(result==='SUCCESS'){assert.equal(g.phase,'ASSASSINATE');assert.ok(!Object.hasOwn(observe(g),'roles'));assert.ok(!JSON.stringify(actionPayload(g,{actor:'ai3',type:'ASSASSINATE'})).includes('roleGuess'));
   g=apply(g,'ai3',{type:'ASSASSINATE',target:'ai1'});}
  assert.equal(g.phase,'ENDED');assert.equal(observe(g).roleGuess.correct,4);assert.deepEqual(observe(g).roleGuess.guesses,correct);
 }
});

test('부분·전부 오답을 정확히 계산하고 잘못된 입력·역할 수·시점·AI 제출은 거부한다',()=>{
 const g=setup();for(const [guesses,count] of [[{ai1:'LOYAL',ai2:'MERLIN',ai3:'MINION',ai4:'ASSASSIN'},0],[{ai1:'MERLIN',ai2:'LOYAL',ai3:'MINION',ai4:'ASSASSIN'},2]])assert.equal(apply(g,'human',{type:'ROLE_GUESS',guesses}).roleGuess.correct,count);
 for(const guesses of [null,[],{}, {...correct,ai1:'UNKNOWN'}, {...correct,ai2:'MERLIN'}, {...correct,human:'LOYAL'}])assert.throws(()=>apply(g,'human',{type:'ROLE_GUESS',guesses}));
 assert.throws(()=>apply(g,'ai1',{type:'ROLE_GUESS',guesses:correct}));
 for(const altered of [{...g,quests:g.quests.slice(0,2)},{...g,phase:'VOTE_RESULT'},{...g,aiConfig:{}}]){assert.equal(roleGuessPending(altered),false);assert.throws(()=>apply(altered,'human',{type:'ROLE_GUESS',guesses:correct}));}
 assert.equal(roleGuessPending({...g,aiConfig:{}}),false);
});

test('제출 후 새로고침에서도 정답을 숨기고 종료 로그에 버전·채점·분모를 기록한다',async()=>{
 const g=apply(setup(),'human',{type:'ROLE_GUESS',guesses:correct}), restored=JSON.parse(JSON.stringify(g));
 assert.deepEqual(observe(restored).roleGuess,{pending:false,submitted:true});assert.equal(restored.roleGuess.aiConfig.policyVersion,'test');
 const db={prepare:()=>({bind(){return this;},async all(){return {results:[]};}})};
 const log=await gameLog(db,{...restored,phase:'ENDED'});assert.equal(log.roleGuess.correct,4);assert.equal(log.roleGuess.total,IDS.length-1);assert.equal(log.roleGuess.metricVersion,ROLE_GUESS_VERSION);
});
