import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,newGameHumanRoleMode,observe,observeModerator,ROLES} from '../lib/game.mjs';
import {actionPayload} from '../lib/action-selection.mjs';
import {routingPayload} from '../lib/discussion-routing.mjs';
import {compareModelLogs,COMPARISON_VERSION} from '../lib/comparison.mjs';
test('충신 고정은 AI 역할 구성/무작위 리더를 보존하고 기존 무작위 모드와 입력 경계를 유지한다',()=>{
 assert.equal(newGameHumanRoleMode(),'loyal-fixed');
 for(const bad of [null,'MERLIN','',{},true])assert.throws(()=>newGameHumanRoleMode(bad));
 const leaders=new Set(),assignments=new Set(),randomRoles=new Set();
 for(let seed=1;seed<=100;seed++){
  let state=seed;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
  const g=createGame(random,'loyal-fixed');assert.equal(g.roles.human,'LOYAL');assert.deepEqual(Object.values(g.roles).sort(),[...ROLES].sort());
  assignments.add(JSON.stringify(g.roles));leaders.add(g.leader);assert.deepEqual(observe(g).known,[]);
  g.aiConfig={humanRoleMode:'loyal-fixed'};
  for(const view of [observeModerator(g),observe(g,'ai1'),routingPayload(g,{actor:'ai1',type:'DISCUSS'}),actionPayload(g,{actor:'ai1',type:'PROPOSE'})])assert.ok(!JSON.stringify(view).includes('loyal-fixed'));
  randomRoles.add(createGame(random,'random').roles.human);
 }
 assert.equal(leaders.size,5);assert.ok(assignments.size>1);assert.equal(randomRoles.size,4);
 assert.deepEqual(createGame(()=>.5).roles,createGame(()=>.5,'random').roles);
});
test('종료 로그의 역할 배정 방식은 비교 조건에서 무작위/고정/과거 미기록을 분리한다',()=>{
 const logs=['loyal-fixed','random',undefined].map((humanRoleMode,i)=>({format:'avalon-game-log-v1',game:{...createGame(()=>.5,'loyal-fixed'),id:String(i),phase:'ENDED',winner:'GOOD',aiConfig:{humanRoleMode,model:'test',comparisonVersion:COMPARISON_VERSION,routingMode:'baseline',actionMode:'gemini'}},events:[],modelUsage:[]}));
 const result=compareModelLogs(logs);assert.equal(result.byConditions.length,3);assert.deepEqual(result.games.map(g=>g.conditions.humanRoleMode),['loyal-fixed','random',null]);
});
