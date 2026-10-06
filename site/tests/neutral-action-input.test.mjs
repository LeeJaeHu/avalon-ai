import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,observe,observeModerator,NAMES} from '../lib/game.mjs';
import {buildPromptV3} from '../lib/prompts/v3.mjs';
import {responseSchema} from '../lib/response-schema.mjs';

// The format contract must not recommend a concrete team, vote, card, or target.
test('행동 입력은 구체 선택 예시 없이 유저 명칭과 합법 선택 범위를 전달한다',()=>{
 const game=createGame(()=>.5);game.roles.ai2='ASSASSIN';game.phase='PROPOSE';game.quest=2;
 for(const type of ['PROPOSE','VOTE','CARD','ASSASSINATE']){
  const view=observe(game,'ai2');
  const prompt=buildPromptV3({request:{actor:'ai2',type},view,publicState:observeModerator(game),personalInfo:{id:'ai2',name:NAMES.ai2,role:view.role,known:view.known}});
  const request=JSON.parse(prompt.split('이번 요청은 다음과 같습니다.')[1].trim().split('\n')[0]);
  const state=JSON.parse(prompt.split('공개 정보는 다음과 같습니다.')[1].trim().split('\n')[0]);
  assert.equal(state.names.human,'유저');assert.equal(state.names.ai2,'도윤');
  assert.equal(request.actor,'ai2');assert.equal(request.requiredTeamSize,2);
  assert.deepEqual(request.allowedTypes,[type]);
  for(const key of ['outputExample','team','choice','target'])assert.ok(!Object.hasOwn(request,key));
  const schema=responseSchema({actor:'ai2',type},view);
  if(type==='CARD')assert.deepEqual(schema.properties.choice.enum,['SUCCESS','FAIL']);
  if(type==='VOTE')assert.deepEqual(schema.properties.choice.enum,['APPROVE','REJECT']);
  if(type==='PROPOSE')assert.ok(schema.properties.team.items.enum.includes('ai2'));
  if(type==='ASSASSINATE')assert.ok(schema.properties.target.enum.includes('ai4'));
 }
 assert.equal(NAMES.human,'유저');assert.ok(!Object.values(NAMES).includes('나'));
});
