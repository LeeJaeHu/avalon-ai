import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,observe,observeModerator} from '../lib/game.mjs';
import {ROLE_GUIDES,publicRoleCounts,roleGuide,privateRoleKnowledge,roleInteractions} from '../lib/role-guide.mjs';
test('공개 역할 집계는 배정 순서·참가자와 무관하고 개별 역할표를 노출하지 않는다',()=>{
 const a={human:'MERLIN',ai1:'LOYAL',ai2:'ASSASSIN',ai3:'LOYAL',ai4:'MINION'},b={human:'LOYAL',ai1:'ASSASSIN',ai2:'LOYAL',ai3:'MINION',ai4:'MERLIN'};
 assert.equal(JSON.stringify(publicRoleCounts(a)),JSON.stringify(publicRoleCounts(b)));
 const g=createGame(()=>.5);g.roles=a;const view=observe(g),moderator=observeModerator(g);
 assert.deepEqual(view.roleCounts,{LOYAL:2,MERLIN:1,ASSASSIN:1,MINION:1});assert.equal(Object.hasOwn(view,'roles'),false);assert.equal(Object.hasOwn(moderator,'roles'),false);assert.deepEqual(moderator.roleCounts,view.roleCounts);
 assert.ok(!JSON.stringify(view.roleCounts).includes('human'));
});
test('현재 역할 설명은 승리·능력·허용 선택을 포함하고 암살 기회를 명시한다',()=>{
 for(const role of ['LOYAL','MERLIN','ASSASSIN','MINION']){const guide=roleGuide(role);assert.ok(guide.win&&guide.ability&&guide.quest&&guide.summary);assert.equal(guide.notes.some(n=>n.includes('오베론')),false);}
 assert.match(roleGuide('ASSASSIN').ability,/원정 3회 성공 후 한 명을 한 번/);assert.match(roleGuide('LOYAL').quest,/반드시 성공/);assert.match(roleGuide('MINION').quest,/성공 또는 실패/);
});
test('확장 예외는 해당 역할 구성에서만 표시한다',()=>{
 const counts={MERLIN:1,PERCIVAL:1,LOYAL:2,ASSASSIN:1,MORGANA:1,OBERON:1};
 for(const role of ['ASSASSIN','MINION','MORGANA','MORDRED'])assert.ok(roleGuide(role,counts).notes.some(n=>n.includes('동료 목록에 표시되지 않으며')));
 assert.match(roleGuide('OBERON',counts).ability,/멀린에게는 악/);assert.match(roleGuide('PERCIVAL',counts).ability,/누가 누구인지는 모릅니다/);assert.match(roleGuide('PERCIVAL',{}).ability,/멀린이 누구인지/);
 assert.equal(roleGuide('MERLIN',counts).notes.some(n=>n.includes('모드레드')),false);assert.ok(roleGuide('MERLIN',{MORDRED:1}).notes.some(n=>n.includes('목록에 없는 사람도 악')));assert.equal(roleInteractions(counts).length,2);
});
test('개인 정보는 허용된 known만 사용하며 공개 설명에는 사람 이름을 넣지 않는다',()=>{
 const v={role:'ASSASSIN',known:['ai1','foreign'],ids:['human','ai1','ai2'],names:{ai1:'동료',ai2:'미공개'},roles:{ai2:'MERLIN'}};
 assert.equal(privateRoleKnowledge(v),'당신의 악 동료: 동료');assert.ok(!JSON.stringify(ROLE_GUIDES).includes('동료: 동료'));
 assert.equal(privateRoleKnowledge({...v,role:'LOYAL'}),'다른 참가자의 진영과 역할을 모릅니다.');assert.equal(privateRoleKnowledge({...v,role:'OBERON'}),'다른 악 플레이어가 누구인지 모릅니다.');
});
