import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, PERSONA_GUIDANCE, personaPrompt } from '../lib/prompts/personas.mjs';
import { TEMPLATE, buildPromptV2, PROMPT_VERSION } from '../lib/prompts/v2.mjs';
import { createGame, observe, observeModerator } from '../lib/game.mjs';

test('성향은 역할과 독립적이며 모든 모델 행동에 본인 것만 정확히 한 번 삽입된다', () => {
  assert.equal(PROMPT_VERSION,'V2-persona-evidence-v1');
  for (const actor of Object.keys(PERSONAS)) for (const role of ['MERLIN','LOYAL','ASSASSIN','MINION']) {
    const game = createGame(() => 0.5); game.roles[actor] = role;
    const view = observe(game,actor);
    for (const type of ['CHAT','PROPOSE','VOTE','CARD','ASSASSINATE']) {
      const input = {request:{actor,type},view,publicState:observeModerator(game),personalInfo:{role:view.role,known:view.known}};
      const prompt = buildPromptV2(input);
      assert.equal(prompt.split(PERSONAS[actor]).length-1,1);
      assert.equal(prompt.split(PERSONA_GUIDANCE).length-1,1);
      for(const [other,text] of Object.entries(PERSONAS)) if(other!==actor) assert.ok(!prompt.includes(text));
      assert.ok(prompt.indexOf(PERSONAS[actor]) < prompt.indexOf('공개 정보는 다음과 같습니다.'));
      assert.ok(!prompt.includes('[역할]'));
    }
  }
});

test('원본 V2에는 성향을 쓰지 않고 사람에게 임의 페르소나를 부여하지 않는다', () => {
  assert.equal(personaPrompt('human'),'');
  assert.equal(personaPrompt('unknown'),'');
  assert.ok(!TEMPLATE.includes(PERSONA_GUIDANCE));
});
