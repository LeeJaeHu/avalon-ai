import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,apply,IDS} from '../lib/game.mjs';
function ready(){let g=createGame(()=>.5);g.aiConfig={routingMode:'jev',conversationVersion:1};g.leader='human';g=apply(g,'human',{type:'START'});g=apply(g,'human',{type:'PROPOSE',team:['human','ai1']});for(const actor of ['ai1','ai2'])g=apply(g,actor,{type:'CHAT',text:'공개 근거를 확인했습니다.',speechAct:'ANSWER'});return apply(g,'system',{type:'ANNOUNCE_VOTE'});}
test('예고된 투표·결과는 사람이 즉시 이동하고 자동 전환은 8초를 기다린다',()=>{
 let g=ready();const vote={type:'START_VOTE',skipWaitAt:g.conversation.voteAt};
 assert.throws(()=>apply(g,'system',{type:'START_VOTE'}));
 g=apply(g,'human',vote);assert.equal(g.phase,'VOTE');assert.equal(g.conversation.voteAt,null);
 assert.throws(()=>apply(g,'human',vote));
 for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});
 g=apply(g,'system',{type:'ANNOUNCE_CONTINUE'});
 assert.throws(()=>apply(g,'system',{type:'CONTINUE'}));
 g=apply(g,'human',{type:'CONTINUE',skipWaitAt:g.conversation.continueAt});assert.equal(g.phase,'QUEST');
 for(const actor of ['human','ai1'])g=apply(g,actor,{type:'CARD',choice:'SUCCESS'});
 g=apply(g,'system',{type:'ANNOUNCE_CONTINUE'});g=apply(g,'human',{type:'CONTINUE',skipWaitAt:g.conversation.continueAt});assert.equal(g.quest,1);assert.ok(['PROPOSE','TEAM_DISCUSSION'].includes(g.phase));
});
test('예고 취소·변경·일시정지·권한 오류에서는 바로 이동하지 않는다',()=>{
 const g=ready(),action={type:'START_VOTE',skipWaitAt:g.conversation.voteAt};
 assert.throws(()=>apply({...g,conversation:{...g.conversation,voteAt:null}},'human',action));
 assert.throws(()=>apply({...g,conversation:{...g.conversation,voteAt:action.skipWaitAt+1}},'human',action));
 assert.throws(()=>apply(apply(g,'human',{type:'PAUSE'}),'human',action));
 assert.throws(()=>apply(g,'ai1',action));
 assert.throws(()=>apply(g,'human',{type:'CONTINUE',skipWaitAt:action.skipWaitAt}));
});
