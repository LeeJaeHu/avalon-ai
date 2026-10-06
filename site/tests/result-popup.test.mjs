import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,apply,observe,IDS} from '../lib/game.mjs';import {resultPopup,questHistoryPopup} from '../lib/result-popup.mjs';
const setup=()=>{let g=createGame(()=>.5);g.leader='human';g=apply(g,'human',{type:'START'});return apply(g,'human',{type:'PROPOSE',team:['human','ai1']});};
test('팀 초안·수정 사건은 다른 팝업이며 공개 멤버와 리더만 가져온다',()=>{
 let g=setup(),p=resultPopup(observe(g));assert.equal(p.kind,'TEAM');assert.deepEqual(p.players.map(p=>p.id),['human','ai1']);assert.ok(p.description.includes('아직 투표 전'));
 g=apply(g,'human',{type:'PROPOSE',team:['human','ai2']});assert.notEqual(resultPopup(observe(g)).key,p.key);
 const extra={...observe(g),roles:g.roles,privateThinking:{ai1:'SECRET'},cards:{ai1:'FAIL'}};assert.deepEqual(resultPopup(extra),resultPopup(observe(g)));assert.ok(!JSON.stringify(resultPopup(extra)).includes('SECRET'));
});

test('과거 원정은 proposalId로 당시 리더·팀·공개 표·실패 합계를 연결한다',()=>{
 let g=apply(setup(),'human',{type:'START_VOTE'});
 for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:actor==='ai4'?'REJECT':'APPROVE'});
 g=apply(g,'human',{type:'CONTINUE'});g.roles.ai1='MINION';
 g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});g=apply(g,'ai1',{type:'CARD',choice:'FAIL'});
 const view=observe(g);view.quest=3;view.leader='ai3';view.proposals.push({id:'later',quest:3,attempt:1,leader:'ai3',status:'DRAFT',team:['ai2','ai3']});
 const p=questHistoryPopup(view,'quest-1');assert.equal(p.quest,1);assert.equal(p.leader,view.names.human);assert.equal(p.approve,4);assert.equal(p.reject,1);assert.equal(p.fails,1);assert.equal(p.tone,'failure');assert.equal(p.history,true);assert.deepEqual(p.players.map(x=>x.id),['human','ai1']);
 assert.deepEqual(questHistoryPopup({...view,roles:g.roles,cards:{ai1:'FAIL'},privateThinking:'SECRET'},'quest-1'),p);
 assert.equal(questHistoryPopup(view,'quest-2'),null);
 const incomplete=structuredClone(view);incomplete.proposals[0].votes.pop();assert.equal(questHistoryPopup(incomplete,'quest-1'),null);
 incomplete.proposals[0].votes.push(incomplete.proposals[0].votes[0]);assert.equal(questHistoryPopup(incomplete,'quest-1'),null);
 const missing=structuredClone(view);missing.quests[0].proposalId='missing';assert.equal(questHistoryPopup(missing,'quest-1'),null);
 view.quests[0].result='SUCCESS';view.quests[0].fails=0;assert.equal(questHistoryPopup(view,'quest-1').tone,'success');
});
test('전원 투표 전에는 결과를 표시하지 않고 승인/부결과 공개 표만 표시한다',()=>{
 for(const approved of [true,false]){let g=apply(setup(),'human',{type:'START_VOTE'});assert.equal(resultPopup(observe(g)),null);
 for(const actor of IDS.slice(0,-1))g=apply(g,actor,{type:'VOTE',choice:approved?'APPROVE':'REJECT'});assert.equal(resultPopup(observe(g)),null);
 g=apply(g,IDS.at(-1),{type:'VOTE',choice:'APPROVE'});const p=resultPopup(observe(g));assert.equal(p.title,approved?'원정 팀 승인':'원정 팀 부결');assert.equal(p.votes.length,5);assert.equal(p.approve,approved?5:1);
 assert.equal(resultPopup({...observe(g),proposals:[{...g.proposals.at(-1),votes:[]}]}),null);}
 let g=apply(setup(),'human',{type:'START_VOTE'});for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'REJECT'});g.proposals.at(-1).attempt=5;assert.ok(resultPopup(observe(g)).description.includes('악의 승리'));
});
test('임무 전원 제출 후 합계만 표시하고 카드 주인·역할을 노출하지 않는다',()=>{
 for(const success of [true,false]){let g=apply(setup(),'human',{type:'START_VOTE'});for(const actor of IDS)g=apply(g,actor,{type:'VOTE',choice:'APPROVE'});g=apply(g,'human',{type:'CONTINUE'});g.roles.ai1='MINION';
 g=apply(g,'human',{type:'CARD',choice:'SUCCESS'});assert.equal(resultPopup(observe(g)),null);g=apply(g,'ai1',{type:'CARD',choice:success?'SUCCESS':'FAIL'});
 const p=resultPopup(observe(g));assert.equal(p.title,success?'원정 성공':'원정 실패');assert.equal(p.fails,success?0:1);assert.ok(!JSON.stringify(p).includes('MINION'));assert.ok(!Object.hasOwn(p,'cards'));assert.ok(!Object.hasOwn(p,'votes'));}
});
