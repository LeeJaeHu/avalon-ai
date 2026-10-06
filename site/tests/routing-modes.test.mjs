import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, SPEECH_ACTS } from '../lib/game.mjs';
import { decide, nextAiAction } from '../lib/ai.mjs';
import { JEV_MODEL, newGameRoutingMode, routingNotice } from '../lib/discussion-routing.mjs';

test('새 판 모드만 허용하고 기존 판 기본값과 대체 안내를 보존한다', () => {
  assert.equal(newGameRoutingMode(undefined), 'baseline');
  for (const mode of ['baseline','shadow','jev']) assert.equal(newGameRoutingMode(mode), mode);
  for (const mode of ['', 'other', {}, 1]) assert.throws(() => newGameRoutingMode(mode));
  assert.equal(routingNotice({ mode: 'jev', status: 'OK' }), null);
  assert.equal(routingNotice({ mode: 'baseline', status: 'BASELINE' }), null);
  for (const status of ['FALLBACK','NO_KEY','PRACTICE_NO_MODEL']) assert.match(routingNotice({ mode:'jev',status }), /기존 방식/);
});

test('운영 V2에서 기존 방식은 Gemini만, JEV 방식은 선택한 참가자의 Gemini를 호출한다', async () => {
  let game = apply(createGame(() => 0.5), 'human', { type:'START' });
  game = apply(game,'ai2',{type:'CHAT',text:'하린을 추천합니다.',speechAct:'TEAM_SUGGESTION'});
  game = apply(game,'human',{type:'CHAT',text:'하린을 고른 이유는 무엇인가요?',speechAct:'QUESTION'});
  const originalFetch = globalThis.fetch;
  const calls=[];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push(url);
      if (url.includes('typesafe')) return Response.json({model:JEV_MODEL, answers:{
        responder:{type:'choice',choice:'ai2',confidence:1,probabilities:{ai1:0,ai2:1,ai3:0,ai4:0,WAIT:0}},
        speechAct:{type:'choice',choice:'QUESTION',confidence:1,probabilities:Object.fromEntries(SPEECH_ACTS.map(id=>[id,id==='QUESTION'?1:0]))}
      },usage:{input_tokens:1200}});
      const prompt = JSON.parse(init.body).contents[0].parts[0].text;
      assert.ok(prompt.includes(`"actor":"${game.aiConfig.routingMode==='jev'?'ai2':'ai1'}"`));
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({type:'CHAT',text:'공개된 근거부터 확인해 볼게요.',speechAct:'ANSWER'})}]}}]});
    };
    game.aiConfig={routingMode:'baseline'};
    const baseline=await decide(game,nextAiAction(game),'mock-gemini',null,{key:'mock-jev'});
    assert.equal(baseline.mode,'gemini'); assert.equal(baseline.actor,'ai1');
    assert.equal(calls.length,1); assert.ok(!calls[0].includes('typesafe'));
    game.aiConfig.routingMode='jev';calls.length=0;
    const jev=await decide(game,nextAiAction(game),'mock-gemini',null,{key:'mock-jev'});
    assert.equal(jev.mode,'gemini');assert.equal(jev.actor,'ai2');assert.equal(calls.length,2);
    assert.equal(jev.routing.applied,true); assert.equal(jev.routing.inputTokens,1200);
    assert.equal(apply(game,jev.actor,jev.action).messages.at(-1).actor,'ai2');
  } finally { globalThis.fetch=originalFetch; }
});
